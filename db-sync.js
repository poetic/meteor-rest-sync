/*
 * Discussion
 *   Their timestamps need to be generated in DB! Lack of strict chronologic ordering from their files results in missed data.
 *
 * Technical Debt
 *   Setup CI
 *   Add more tests
 *   Refactor
 *   Migrate to differential:worker from percolate:synced-cron
 *   Add indexes
 *   Determine cause of remote problems
 *   Add ability to have some overlap in timestamps
 *   Allow configuration of inbound routes
 *
 * Packaging
 *   Add tech demo to package after stripping out nosh-pit name etc.
 */


DBSync = {};

DBSync._errors = new Mongo.Collection("syncErrors");
DBSync._cronJobName = 'Poll remote for inserts and updates and retry inserts, updates, and deletes.';

DBSync._lastUpdate = new Mongo.Collection("syncLastUpdate");
DBSync.getLastUpdate = function(key){
  var record = DBSync._lastUpdate.findOne({collection: key});
  if( record ){
    return moment(record.lastUpdated).utc().toDate();
  }
};

DBSync.configure = function( config ){
  this._settings = _.defaults({},config,{
    collections:{}
  });
 
  this._settings.restivus_options = _.defaults({},config.restivus_options,{
    apiPath: "rest-sync"
  });
};

DBSync.addCollection = function( config ){
  this._settings.collections[ config.collection._name ] = _.defaults(config,{
    "remote_external_id_field": "id",
  });
  
  this._settings.collections[ config.collection._name ].mapOut = _.defaults(config.mapOut,{
    "_id": {mapTo: "external_id"},
    "deleted_at": {mapTo: "deleted_at"},
    "externalId": {mapTo: "id"},
  });
  
  this._settings.collections[ config.collection._name ].mapIn = _.defaults(config.mapIn,{
    "external_id": {mapTo: "_id"},
    "id": {mapTo: "externalId", mapFunc: function(val){
      return val.toString();
    }},
    "deleted_at": {mapTo: "deleted_at"},
    "updated_at": {mapTo: "updated_at"},
  });
};

DBSync.collections = function( ){
  return Object.keys( this._settings.collections );
};

DBSync.collectionSettings = function( key ){
  return this._settings.collections[ key ];
};

DBSync._convert = function(doc, mapping){
  var newDoc = {};
  _.each(mapping,function( val,key ){
    if( doc[key] ){
      if( val.mapFunc ){
        newDoc[ val.mapTo ] = val.mapFunc( doc[key] )
      }else{
        newDoc[ val.mapTo ] = doc[key];
      }
    }
  });
  return newDoc;
}

DBSync._handleInsert = function( key, doc, callback ){
  var settings = this._settings.collections[ key ];
  var railsDoc = this._convert( doc, settings.mapOut );
  var field = settings.newDoc.field;
  var route = settings.newDoc.route;

  var params = {};
  params[field] = railsDoc;
  var reqObject = {data: params};
  HTTP.post(this._settings.remote_root + route, reqObject, callback);
};

DBSync._handleUpdate = function( key, doc, callback ){
  var settings = this.collectionSettings( key );
  var remoteDoc = this._convert( doc, settings.mapOut );
  if( !remoteDoc.id ){
    callback( "No external ID found on record" );
  }else{
    var field = settings.updateDoc.field;
    var route = this._settings.remote_root + 
      settings.updateDoc.route.replace(":id", remoteDoc[settings.remote_external_id_field] );

    var params = {};
    params[field] = _.omit(remoteDoc,"id");
    var reqObject = {data: params};
    HTTP.put( route, reqObject, callback);
  }
};

DBSync._handleSync = function( key ){
  var self = this;
  var settings = self.collectionSettings(key);
  settings.collection.after.insert(function (userId, doc) {
    self._handleInsert( key, doc, function(err, resp){
      if( err ){
        console.error( "Rails Insert Failed: " + err );
        self._errors.insert({'id': doc._id, type: "insert", collection: key, retries: 0});
      }else{
        // Don't propogate (trigger hooks) this change
        settings.collection.direct.update({_id: doc._id},{$set: {externalId: resp.data.id.toString()}});
      }
    });
  });
  
  settings.collection.after.update(function (userId, doc, fieldNames, modifier, options) {
    self._handleUpdate( key, doc, function(err, resp){
      if( err ){
        console.error( "Rails Update Failed", err );
        self._errors.insert({'id': doc._id, type: "update", collection: key, retries: 0});
      }
    });
  });
}; 

/*
 * Take the response from the index of a collection, 
 * make any insert and updates nessecary.
 * Add errors to retry queue as they occur.
 */
DBSync._handleFetch = function(err, resp, key ){
  var self = this;
  var settings = self.collectionSettings(key);
  if( err ){
    console.error( "Could not retrieve latest data from remote" );
  }else{
    var docs = JSON.parse( resp.content );
    var last_update;
    var error_count = 0;
    _.each( docs, function(doc){
      try{
        var meteorVersion = self._convert( doc, settings.mapIn );

        /*
         * If an error occured the last time we sent an update for
         * the specific document.  Then compare timestamps, and prefer 
         * the last updated.
         */
        var errors = self._errors.find({collection: key, id: meteorVersion._id}).count() > 0;
        var lastUpdateLocal;
        if( errors ){
          var updated = settings.collection.findOne({'_id': meteorVersion._id}).updated_at;
          lastUpdateLocal = moment(updated).isAfter( meteorVersion.updated_at );
          console.error( "Conflicts found during fetch, most recent version used" );
        }

        if( !lastUpdateLocal ){
          if(settings.collection.findOne( {externalId: meteorVersion.externalId.toString()} ) ){
            settings.collection.direct.update(
              {externalId: meteorVersion.externalId.toString()},
              _.omit(meteorVersion,"_id")
            );
          }else if( settings.collection.findOne( {_id: meteorVersion._id} ) ){
            settings.collection.direct.update(
              {_id: meteorVersion._id},
              _.omit(meteorVersion,"_id")
            );
          }else{
            settings.collection.direct.insert(meteorVersion);
          }
          if( !last_update || moment( meteorVersion.updated_at ).isAfter( last_update ) ){
            last_update = moment( meteorVersion.updated_at ); 
          }
        }
      }catch(e){
        error_count++;
        console.error( "Error during fetch convert for key: " + key + " - " + e );
      }
    });

    /*
     * Update the last_update in the database
     */
    if( last_update && error_count === 0 ){
      var currentLastUpdate = self.getLastUpdate( key );
      if( currentLastUpdate ){
        self._lastUpdate.update({collection: key},{$set: {lastUpdated: last_update.toDate()}});
      }else{
        self._lastUpdate.insert({lastUpdated: last_update.toDate(), collection: key});
      }
    }
  }
}

DBSync.fetch = function(  ){
  var self = this;
  _.each( self.collections(),function( key ){
    var settings = self.collectionSettings(key);
    var indexUrl = self._settings.remote_root + settings.index.route;

    var last_updated = DBSync.getLastUpdate( key );
    var reqObject = {data: {updated_since: last_updated}};
    HTTP.get(indexUrl,reqObject,function(err,resp){
      self._handleFetch( err, resp, key );
    });
  });
}

DBSync.retryErrors = function( callback ){
  var self = this;
  self._errors.find(
    {'type': "insert", "retries": {$lte: self._settings.max_retries}}
  ).forEach(
      function(errRecord){ 
      var settings = self.collectionSettings(errRecord.collection);
      var doc  = settings.collection.findOne({_id: errRecord.id});
      if( doc ){
        self._handleInsert( errRecord.collection, doc,function(err,resp){
          if( !err ){
            self._errors.remove({id: errRecord.id, collection: errRecord.collection});
            settings.collection.direct.update({_id: errRecord.id},{$set: {externalId: resp.data.id}});
          }else{
            self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
            console.log( "Remote insert retry fail" );
          }
        });
      }else{
        // We remove all errors related to that record 
        // Since inserts and updates are document level, correctly processing 1
        // will result in all other errors related to that record also being resolved.
        self._errors.remove({_id: errRecord._id,type: "insert", collection: errRecord.collection});
        console.log( "Doc that failed to insert on rails, no longer exists in meteor" );
      }
    }
  );
  
  self._errors.find(
    {'type': "updates", "retries": {$lte: self._settings.max_retries}}
  ).forEach(
    function(errRecord){ 
      var settings = self.collectionSettings(errRecord.collection);
      var doc  = settings.collection.findOne({_id: errRecord.id});
      if( doc ){
        if( !doc.externalId ){
          self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
        }else{
          self._handleUpdates( errRecord.collection, doc,function(err,resp){
            if( !err ){
              self._errors.remove({_id: errRecord._id});
            }else{
              self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
              console.error( "Remote update retry fail" );
            }
          });
        }
      }else{
        self._errors.remove({_id: errRecord._id,type: "insert"});
        console.log( "Doc that failed to insert on rails, no longer exists in meteor. This case shouldn't be possible due to using deleted_at." );
      }
    }
  );
  
  if( callback ){
    callback();
  }
}

/*
 * Should only be called on startup
 * This is entirely to handle the case where the server shutdown (or crashed)
 * while an insert was in progress, before getting external ID back.
 */ 
DBSync._handleMissingExternalIds = function( key ){
  var self = this;
  var settings = self.collectionSettings(key);
  settings.collection.find({externalId: {$exists: 0}}).forEach(function(doc){
    // Check that it isn't already in error retry queue
    var error = self._errors.findOne({collection: key, type: "insert", id: doc}); 
    if( error ){ return; }

    // Query remote system to see if they have our record
    var indexUrl = self._settings.remote_root + settings.index.route;

    var last_updated = DBSync.getLastUpdate( key );
    var reqObject = {data: {external_id: doc._id}};
    HTTP.get(indexUrl,reqObject,function(err,resp){ 
      if( err ){
        console.error( "Error checking remote for existance of documents missing remote ID: " + err );
      }else{
        var docs = JSON.parse( resp.content );
        if( docs.length > 1 ){
          console.error( "Requesting documents with externalID from remote returned multiple" );
        }else if( docs.length === 0 ){
          self._errors.insert({'id': doc._id, type: "insert", collection: key, retries: 0});
        }else{
          settings.collection.update(
            {_id: doc._id},
            {externalId: docs[0][settings.remote_external_id_field.toString()]}
          );
        }
      }
    });
  });
};


DBSync._setupApi = function( key ){
  var self = this;
  var settings = this.collectionSettings( key );

  /*
   * Wasn't able to setup using Api.addRoute.  
   * It seems to not successfully catch requests when setup that way.
   */

  DBSync._api.addCollection(settings.collection,
    { excludedEndpoints: ["delete","getAll", "get"],
      endpoints: {
        put: {
          action: function(){
            var req = this;
            var meteorDoc = self._convert(req.bodyParams, settings.mapIn);

            // It should be one of the two cases
            if( meteorDoc._id ){
              settings.collection.direct.update({_id: meteorDoc._id}, {$set: meteorDoc} );
              return settings.collection.findOne({_id: meteorDoc._id});
            }else{
              settings.collection.direct.update({externalId: meteorDoc.externalId}, {$set: meteorDoc} );
              return settings.collection.findOne({externalId: meteorDoc.externalId});
            }
          }
        },
        post: {
          action: function(){
            var req = this;
            var meteorDoc = self._convert( req.bodyParams, settings.mapIn );
            // Custom upsert, collection hooks don't allow direct access for upsert for some reason
            
            console.log( meteorDoc ); 
            var id;
            if( settings.collection.findOne({_id: meteorDoc._id}) ){
              settings.collection.direct.update({_id: meteorDoc._id},meteorDoc );
              id = meteorDoc._id;
              return settings.collection.findOne({_id: id});
            }else{
              id = settings.collection.direct.insert( meteorDoc );
              var doc = settings.collection.findOne({externalId: meteorDoc.externalId});
              return doc;
            }
          }
        }
      }
    }
  );
};

SyncedCron.add({
  name: DBSync._cronJobName,
  schedule: function(parser) {
    // parser is a later.parse object
    return parser.text(DBSync._settings.poll_length);
  },
  job: function() {
    DBSync.retryErrors();
    DBSync.fetch();
  }
});

DBSync.start = function(){
  DBSync._api = new Restivus(DBSync._settings.restivus_options);
  
  var self = this;
  _.each( Object.keys(this._settings.collections), function( key ){
    // Adjust scope to keep it as DBSync
    self._handleSync( key );
    
    self._setupApi( key );

    self._handleMissingExternalIds( key );
  });

  SyncedCron.start();
};
