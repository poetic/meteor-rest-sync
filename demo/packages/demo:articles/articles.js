Articles = new Mongo.Collection('articles');
Comments = new Mongo.Collection('comments');


if( Meteor.isClient ){
  LastUpdate = new Mongo.Collection("syncLastUpdate");
  Meteor.subscribe('lastSyncTimestamp');

  Articles.addSeedArticle = function(){
    Meteor.call('addArticle');
  };
  
  Comments.addSeed = function(id){
    Meteor.call('addComment', id);
  };

  Template.helloWorld.helpers({
    articles: function(){
      return Articles.find({deleted_at: {$exists: 0}},{sort: {'title': 1}});
    },
    comments: function(){
      return Comments.find({'articleId': this._id, deleted_at: {$exists: 0}});
    },
    timestamp: function(){
      if( LastUpdate.findOne() ){
        return moment(LastUpdate.findOne().lastUpdated).utc().toDate();
      }
    }
  });

  Template.helloWorld.events({
    'click button[name="resync"]': function(){
      console.log( "Resyncing" );
      Meteor.call('triggerSync');
    },
    'click button[name="add-article"]': function(){
      Articles.addSeedArticle();
    },
    'click button[name="add-comment"]': function(){
      Comments.addSeed(this._id);
    },
    'click button[name="remove-comment"]': function(){
      Comments.update({_id: this._id},{$set: {deleted_at: moment().toDate()}});
    },
    'click button[name="remove-article"]': function(){
      Articles.update({_id: this._id},{$set: {deleted_at: moment().toDate()}});
    }
  });
}

if( Meteor.isServer ){
  Meteor.methods({
    'addArticle': function(){
      Articles.insert({
        title: Fake.sentence(3),
        body: Fake.paragraph(),
        author: Fake.user().name,
      });
    },
    'addComment': function( id ){
      Comments.insert({
        articleId: id,
        body: Fake.sentence(),
      },function(err){ console.error("error inserting comment" + err); });
    }
  });
}
