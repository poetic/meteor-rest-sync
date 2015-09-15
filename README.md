## How it works

It polls the remote for all changes after a certain date.  It sends changes in realtime to specified endpoints on the remote.  If the realtime change request fails, it will retry a certain set amount of times.  Updates and inserts are done as full documents, rather than on a field by field basis.

### Why External ID is needed on you're remote

ExternalID is required for the case where an insert was in the process when the application crashed or was shut down.  Without remote external ID we cannot know for certain if the remote system successfully inserted the document.

### Why Deleted_At is required

We need some way to query all records that have been deleted since a certain time.  This isn't as important in the case where the remote is sending realtime changes.  It also helps with associated records.

## Basic Requirements

- A deleted_at field is required on remote and meteor side.
- A external_id field is required on remote and meteor side.
- Remote must provide a RESTful api.

### 1 table to 1 collection

One potentially important current limitation is a single collection on the remote equals a single collection locally.

## Config

### Define each collection to sync

### Start it

This must be called to start syncing.  It must be called after all config is complete.

    DBSync.start();
