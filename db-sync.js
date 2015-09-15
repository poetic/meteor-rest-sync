/*
 * Handle case where update occurs before insert gets the remote ID back, less likely to occur now.
 * Handle case where restart occurs during a remote insert
 * Hnadle Case 
 *   to_datetime truncates, causing off by one, resulting in overwrite of recent meteor changes
 *
 *
 * Discussion
 *   Their timestamps need to be generated in DB! Lack of strict chronologic ordering from their files results in missed data.
 *   ExternalID vs nothing in their system.  Specifically, crash during insert response
 *   Case where our table isn't 1 -> 1 with their tables
 *
 *
 * Change to transform model on outbound inbound?
 * Function with doc as argument for endpoints?
 * Need some insulation for their col name -> our col name
 *
 * Technical Debt
 *   Remove dependency on comments and articles
 *   Move config outside
 *   Setup CI
 *   Add more tests
 *   Migrate to differential:worker from percolate:synced-cron
 *   Add indexes
 *   configuration api
 */

/*
 * Updated since
 *
 * Completly rest based, sync is only avaliable if we can 
 * Leave polling code, 
 * Add logs to polling portion as well.
 * Log instead of keeping errors
 * restivus with outbound and inbound matching
 * Migrate back away from global fetch call
 */

var RAILS_ROOT = Meteor.settings.remote_sync_root;
var MAX_RETRIES = 10;
var CollectionOrder = ["articles", "comments"];


DBSync = {};

DBSync._settings = {collections:{}};
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
  this._settings =_.extend( this._settings, config );
};

DBSync.addCollection = function( config ){
  this._settings.collections[ config.collection._name ] = config;

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
    var route = this._settings.remote_root + settings.updateDoc.route( doc );

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
        settings.collection.direct.update({_id: doc._id},{$set: {externalId: resp.data.id}});
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
        if( settings.collection.findOne( {externalId: meteorVersion.externalId} ) ){
          settings.collection.direct.update({externalId: meteorVersion.externalId},meteorVersion);
        }else{
          settings.collection.direct.insert(meteorVersion);
        }
        if( !last_update || moment( meteorVersion.updated_at ).isAfter( last_update ) ){
          last_update = moment( meteorVersion.updated_at ); 
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
    var indexUrl = self._settings.remote_root + settings.index.route

    var last_updated = DBSync.getLastUpdate( key );
    var reqObject = {data: {updated_since: last_updated}};
    HTTP.get(indexUrl,reqObject,function(err,resp){
      self._handleFetch( err, resp, key );
    });
  });
}

DBSync.retryErrors = function( callback ){
  var self = this;
  self._errors.find({'type': "insert", "retries": {$lte: MAX_RETRIES}}).forEach(function(errRecord){ 
    var settings = self.collectionSettings(errRecord.collection);
    var doc  = settings.collection.findOne({_id: errRecord.id});
    if( doc ){
      self._handleInsert( errRecord.collection, doc,function(err,resp){
        if( !err ){
          console.log( "retry success" );
          self._errors.remove({id: errRecord.id, collection: errRecord.collection});
          settings.collection.direct.update({_id: errRecord.id},{$set: {externalId: resp.data.id}});
        }else{
          self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
          console.log( "retry fail" );
        }
      });
    }else{
      self._errors.remove({_id: errRecord._id,type: "insert"});
      console.log( "Doc that failed to insert on rails, no longer exists in meteor" );
    }
  });
  
  self._errors.find({'type': "updates", "retries": {$lte: MAX_RETRIES}}).forEach(function(errRecord){ 
    var settings = self.collectionSettings(errRecord.collection);
    var doc  = settings.collection.findOne({_id: errRecord.id});
    if( doc ){
      if( !doc.externalId ){
        self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
      }else{
        self._handleUpdates( errRecord.collection, doc,function(err,resp){
          if( !err ){
            console.log( "retry success" );
            self._errors.remove({_id: errRecord._id});
          }else{
            self._errors.update({_id: errRecord._id},{$inc: {retries: 1}});
            console.log( "retry fail" );
          }
        });
      }
    }else{
      self._errors.remove({_id: errRecord._id,type: "insert"});
      console.log( "Doc that failed to insert on rails, no longer exists in meteor. This case shouldn't be possible due to using deleted_at." );
    }
  });
  
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
            {externalId: docs[0][settings.external_id_field]}
          );
        }
      }
    });
  });
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
  var self = this;
  _.each( Object.keys(this._settings.collections), function( key ){
    // Adjust scope to keep it as DBSync
    self._handleSync( key );


    self._handleMissingExternalIds( key );
  });

  SyncedCron.start();
};
