Package.describe({
  name: 'poetic:rest-sync',
  version: '0.0.1-rc.4',
  // Brief, one-line summary of the package.
  summary: 'Restful data synchronization for meteor applications.',
  // URL to the Git repository containing the source code for this package.
  git: 'https://github.com/poetic/meteor-rest-sync',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.1.0.3');
  api.addFiles(['db-sync.js'],['server']);
  api.use([
    'matb33:collection-hooks@0.8.0',
    'http',
    'mongo',
    'underscore',
    'percolate:synced-cron@1.3.0',
    'momentjs:moment@2.10.6',
    'nimble:restivus@0.8.4',
    'underscore',
    'ecmascript@0.1.6'
  ],['server']);
  api.export('DBSync');
});

Package.onTest(function(api) {
  api.use([
    'sanjo:jasmine@0.18.0',
    'velocity:core@0.9.3',
    'velocity:html-reporter@0.8.2',
    'pstuart2:velocity-notify@0.0.5',
    'underscore'
  ]);

  api.use([
    'percolate:synced-cron',
    'poetic:rest-sync',
    'http',
    'mongo',
    'momentjs:moment'
  ]);
  api.addFiles('db-sync-tests.js','server');
});
