Package.describe({
  name: 'demo:articles',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.1.0.3');
  
  api.use([
    'anti:fake',
    'matb33:collection-hooks',
    'mongo',
    'templating',
    'momentjs:moment'
  ]);
  
  api.addFiles('articles.html');
  api.addFiles('articles.js');

  api.export('Articles');
  api.export('Comments');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('demo:articles');
  api.addFiles('articles-tests.js');
});
