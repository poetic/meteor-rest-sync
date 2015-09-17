## Basic Requirements

- A deleted_at field is required on remote and meteor side.
- A external_id field is required on remote and meteor side.
- Remote must provide a RESTful api.

## Config

### Base Config


DBSync.configure({
  remote_root: Meteor.settings.remote_sync_root,
  max_retries: 10,
  poll_length: 'every 1 days',
  restivus_options: { // Passed throuw to restivus
    use_default_auth: false
  } 
});

### Define each collection to sync

    var articleOut = {
      "_id": {mapTo: "external_id"},   // Default
      "title": {mapTo: "title"},
      "author": {mapTo: "author"},
      "externalId": {mapTo: "id"},    // Default
      "deleted_at": {mapTo: "deleted_at"},   // Default
    };

    var articleIn = {
      "id": {mapTo: "externalId"},  // Default
      "title": {mapTo: "title"},
      "author": {mapTo: "author"},
      "deleted_at": {mapTo: "deleted_at"},   // Default
      "updated_at": {mapTo: "updated_at"},   // Default
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

    var commentOut = {
      "articleId": {mapTo: "article_id", mapFunc: function( val ){ return Articles.findOne({_id: val}).externalId; }},
      "title": {mapTo: "title"},
      "body": {mapTo: "body"},
      "author": {mapTo: "author"},
    };

    var commentIn = {
      "article_id": {mapTo: "articleId", mapFunc: function( val ){ // Assume externalID is a string
        if( val ){return Articles.findOne({externalId: val.toString()})._id;} }
      },
      "title": {mapTo: "title"},
      "body": {mapTo: "body"},
      "author": {mapTo: "author"},
    };

    DBSync.addCollection({ 
      collection: Comments,
      remote_external_id_field: "id",
      index: {
        route: "/comments.json"
      },
      newDoc: {
        route: "/comments.json",
        field: "comment"
      },
      updateDoc: { // For the moment we assume the route simply has the external Id as a suffix
        route: "/comments/:id.json",
        field: "comment"
      },
      mapOut: commentOut, 
      mapIn: commentIn
    });



### Start it

This must be called to start syncing.  It must be called after all config is complete.

    DBSync.start();

### Rest Endpoints

We also setup endpoints to restfully and in realtime update our local collections when the remote system changes. It uses 'nimble:restivus' under the hood.  Only POST and PUT are provided for insert and update respectively.  The mappings are used for these endpoints as well.  Currently the endpoint uri must point to the local (meteor), collection name, rather than the remote, but the document sent should be the remote version.

## Limitations

### 1 table to 1 collection

One potentially important current limitation is a single collection on the remote equals a single collection locally.



## How it works

It polls the remote for all changes after a certain date.  It sends changes in realtime to specified endpoints on the remote.  If the realtime change request fails, it will retry a certain set amount of times.  Updates and inserts are done as full documents, rather than on a field by field basis.

### Why External ID is needed on your remote

ExternalID is required for the case where an insert was in the process when the application crashed or was shut down.  Without remote external ID we cannot know for certain if the remote system successfully inserted the document.

#### Primarily realtime
It is also necessary when the remote side sends us back an insert call when we sent it first.

### Why Deleted_At is required - Primarily polling edge case

We need some way to query all records that have been deleted since a certain time.  This isn't as important in the case where the remote is sending realtime changes.  It also helps with associated records.

### Why we don't update last_updated if an error has occurred - Primary Polling edge case

We avoid this for the rare case where a child record comes in before a parent record.  This catch's that case, and should cause the system to correct itself on the next poll.

### Why fetch and retry are together - Primarily polling edge case

If we are pulling data we have already recieved such as an error occuring during poll, then we need to be sure that we avoid overwriting any changes on the local side.  Passing the fetched data through the retry logic allows us to filter out records that have been updated on our side from the fetch, before updating the record on our side and overwriting local changes.  

### External ID Normalization

We normalize all external IDS to string.
