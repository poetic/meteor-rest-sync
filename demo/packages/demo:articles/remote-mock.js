var MockRemoteDB = new Mongo.Collection('testCollection');

var MockRemoteImpl = function(){
  MockRemoteDB.remove({});
};

MockRemoteImpl.HTTP = {};
