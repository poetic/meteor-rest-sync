Package.describe({
  name: 'poetic:rest-sync',
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
  api.addFiles(['db-sync.js'],['server']);
  api.use([
    'matb33:collection-hooks',
    'http',
    'mongo',
    'underscore',
    'percolate:synced-cron',
    'momentjs:moment'
  ],['server']);
  api.export('DBSync');
});

Package.onTest(function(api) {
  api.use([
    'sanjo:jasmine@0.18.0',
    'velocity:html-reporter@0.8.2',
    'pstuart2:velocity-notify@0.0.5',
  ],'server');

  api.use([
    'percolate:synced-cron',
    'poetic:rest-sync',
    'http',
    'mongo',
    'momentjs:moment'
  ]);
  api.addFiles('db-sync-tests.js','server');
});
