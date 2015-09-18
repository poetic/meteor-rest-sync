DBSync.configure({
  remote_root: Meteor.settings.remote_sync_root,
  max_retries: 10,
  poll_length: 'every 1 days',
  restivus_options: {
    use_default_auth: false
  }
});

/*
 * Article sync configuration
 */
var articleOut = {
  "title": {mapTo: "title"},
  "author": {mapTo: "author"},
};

var articleIn = {
  "title": {mapTo: "title"},
  "author": {mapTo: "author"},
};

DBSync.addCollection({ 
  collection: Articles, 
  remote_external_id_field: "id",
  index: {
    route: "/articles.json"
  },
  newDoc: {
    route: "/articles.json",
    field: "article"
  },
  updateDoc: { // For the moment we assume the route simply has the external Id as a suffix
    route: "/articles/:id.json",
    field: "article"
  },
  mapOut: articleOut, 
  mapIn: articleIn
});


/*
 * Comment sync configuration
 */
var commentOut = {
  "articleId": {mapTo: "article_id", mapFunc: function( val ){ return Articles.findOne({_id: val}).externalId; }},
  "title": {mapTo: "title"},
  "body": {mapTo: "body"},
  "author": {mapTo: "author"},
};

var commentIn = {
  "article_id": {mapTo: "articleId", mapFunc: function( val ){ 
    if( val ){ return Articles.findOne({externalId: val.toString()})._id;} 
  }},
  "title": {mapTo: "title"},
  "body": {mapTo: "body"},
  "author": {mapTo: "author"},
};

DBSync.addCollection({ 
  collection: Comments,
  remote_external_id_field: "id",  // Default
  index: {
    route: "/comments.json"
  },
  newDoc: {
    route: "/comments.json",
    field: "comment"
  },
  updateDoc: {     
    route: "/comments/:id.json",
    field: "comment"
  },
  mapOut: commentOut, 
  mapIn: commentIn
});

DBSync.start();




Meteor.methods({
  'triggerSync': function(){
    DBSync.fetch( function(callback){ DBSync.retryErrors(callback); });
  }
});

Meteor.publish('lastSyncTimestamp', function(){
  return DBSync._lastUpdate.find();
});

