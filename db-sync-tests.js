beforeAll(function(){
  DBSync.configure({
    remote_root: "http://localhost:3000",
    max_retries: 10,
    poll_length: 'every 1 mins'
  });

  var articleOut = {
    "title": {mapTo: "title"},
    "author": {mapTo: "author"},
  };

  var articleIn = {
    "title": {mapTo: "title"},
    "author": {mapTo: "author"},
  };
  
  Articles = new Mongo.Collection('articles');
  Key = "articles";

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
    updateDoc: { 
      route: "/articles/:id.json",
      field: "article"
    },
    mapOut: articleOut, 
    mapIn: articleIn
  });

  DBSync.start();
});



beforeEach(function(done){
  DBSync._lastUpdate.remove({},function(){
    Articles.remove({},function(){
      DBSync._errors.remove({},function(){
        DBSync._lastUpdate.remove({},done);
      });
    });
  });
});

describe('Meteor insert', function () {
  it('converts to remote version and submits via http.post', function (done) {
    var expected = {"id": "12", "title": "Test title", "author": "test author"};
    var original = {"externalId": "12", "title": "Test title", "author": "test author"};
    spyOn( HTTP, "post" ).and.callFake(function( endpoint, reqObject, callback ){
      var actual = reqObject.data.article;
      expect( _.omit(actual,"external_id") ).toEqual( expected );
      done();
    });
    Articles.insert(original);
  });

  describe("was interrupted while waiting for external ID",function(){
    it("should update the doc if remote has the document",function(){
      var articleId = Articles.direct.insert({});
      var expectedId = "remote id";
      
      var returned = JSON.stringify( [{id: expectedId}] );
      var resp = {content: returned};

      spyOn( HTTP, "get" ).and.callFake(function(route, requestObject, callback){
        callback( "", resp);
      });
      DBSync._handleMissingExternalIds( Key );
      expect( Articles.findOne({'_id': articleId}).externalId ).toBe( expectedId );
    });

    it("should add doc to retry queue doesn't exist remotely",function(){
      spyOn( HTTP, "get" ).and.callFake(function(route, requestObject, callback){
        callback( "Error occured", {} );
      });
    });

    it("log an error if multiple documents are found with single external_id",function(){
      spyOn( HTTP, "get" ).and.callFake(function(route, requestObject, callback){
        callback( "Error occured", {} );
      });
    });
  });
});

describe('Meteor update', function () {
  it('converts to remote version and submits via http.put', function (done) {
    // Expected does _not_ include id.  This is set in the endpoint, 
    // and will be filtered by rails if included.
    var expected = {title: "Test title", author: "author"};
    var modifier = {$set: {author: "author"}};
    var original = {"externalId": "12", "title": "Test title"};
    Articles.direct.insert(original);

    spyOn( HTTP, "put" ).and.callFake(function( endpoint, reqObject, callback ){
      var actual = reqObject.data.article;
      expect( _.omit( actual, "external_id" ) ).toEqual( expected );
      done();
    });

    Articles.update({externalId: "12"},modifier);
  })
});

describe('Meteor update when no externalId is set for document', function () {
  it('should increment retry counter', function () { 
    var article = {title: "Test title", author: "author"};
    var articleId = Articles.direct.insert( article );
    var expected = {id: articleId,type: "update",collection: "articles", retries: 0};

    spyOn( HTTP, "put" ).and.callFake(function(route, requestObject, callback){
      callback( "Error occured", {} );
    });
    Articles.update({'_id': articleId},{title: "Changed Title"});
    expect( _.omit(DBSync._errors.findOne(),"_id") ).toEqual( expected ); 
  });
});


describe('Remote fetch (polling)', function () {
  it("should update last_update for collection",function(){
    DBSync._handleFetch(
      undefined,
      {content: '[{"updated_at": "2012-04-21T18:25:43-05:00","id": "ext_id"}]'}, 
      "articles" 
    );
    var last_update = DBSync._lastUpdate.findOne({collection: "articles"}).lastUpdated;
    expect( last_update ).toBeDefined();
  });

  it("should replace full doc with the newly fetched one",function(){
    var original = {"externalId": "ext_id", "title": "old_title"};
    var expectedTitle = "new_title";
    var inbound = [{"id": "ext_id", "updated_at": "2012-04-21T18:25:43-05:00","title": expectedTitle}];
    Articles.direct.insert( original );
    DBSync._handleFetch(
      undefined, 
      {content: JSON.stringify( inbound )}, 
      "articles" 
    );
    var article = Articles.findOne({'externalId': 'ext_id'});
    expect( article.title ).toEqual( expectedTitle );
  });
});
