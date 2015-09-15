## How it works

It polls the remote for all changes after a certain date.  It sends changes in realtime to specified endpoints on the remote.  If the realtime change request fails, it will retry a certain set amount of times.  Updates and inserts are done as full documents, rather than on a field by field basis.

### Why External ID is needed on your remote

ExternalID is required for the case where an insert was in the process when the application crashed or was shut down.  Without remote external ID we cannot know for certain if the remote system successfully inserted the document.

### Why Deleted_At is required

We need some way to query all records that have been deleted since a certain time.  This isn't as important in the case where the remote is sending realtime changes.  It also helps with associated records.

## Basic Requirements

- A deleted_at field is required on remote and meteor side.
- A external_id field is required on remote and meteor side.
- Remote must provide a RESTful api.

## Config

### Define each collection to sync

    var articleOut = {
      "_id": {mapTo: "external_id"},
      "title": {mapTo: "title"},
      "author": {mapTo: "author"},
      "externalId": {mapTo: "id"},
      "deleted_at": {mapTo: "deleted_at"},
    };

    var articleIn = {
      "id": {mapTo: "externalId"},
      "title": {mapTo: "title"},
      "author": {mapTo: "author"},
      "deleted_at": {mapTo: "deleted_at"},
      "updated_at": {mapTo: "updated_at"},
    };

    DBSync.addCollection({ 
      collection: Articles, 
      external_id_field: "id",
      index: {
        route: "/articles.json"
      },
      newDoc: {
        route: "/articles.json",
        field: "article"
      },
      updateDoc: { // For the moment we assume the route simply has the external Id as a suffix
        route: function( doc ){ return "/articles/" + doc.id + ".json"; },
        field: "article"
      },
      mapOut: articleOut, 
      mapIn: articleIn
    });


### Start it

This must be called to start syncing.  It must be called after all config is complete.

    DBSync.start();


## Limitations

### 1 table to 1 collection

One potentially important current limitation is a single collection on the remote equals a single collection locally.
