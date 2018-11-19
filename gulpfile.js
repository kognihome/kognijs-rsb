'use strict';

var _ = require('lodash');
var gulp = require('gulp');
var browserify = require('browserify');
var uglify = require('gulp-uglify');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var nodeResolve = require('resolve');
var browserSync = require('browser-sync');
var reload = browserSync.reload;

var production = (process.env.NODE_ENV === 'production');

gulp.task('browser-sync', function() {
  browserSync({
    server: {
      baseDir: ["examples", "dist"],
      index: "tour.html",
    },
  });
});

gulp.task('build-vendor', function () {
  var b = browserify({
    debug: !production,
  });

  getNPMPackageIds().forEach(function (id) {
    b.require(nodeResolve.sync(id), { expose: id });
  });

  var stream = b
    .bundle()
    .on('error', function(err){
      console.log(err.message);
      this.emit('end');
    })
    .pipe(source('vendor.js'));

  stream.pipe(gulp.dest('./dist'));
  return stream;
});

gulp.task('build-redist-minified', function() {
  return browserify([
        'src/rsb.js',
        'src/main.js'
      ],  {
        debug: !production,
      })
      .bundle()
      .pipe(source('kognijs.rsb.min.js'))
      .pipe(buffer())
      .pipe(uglify())
      .pipe(gulp.dest('redist/'));
});

gulp.task('build-redist', gulp.series('build-redist-minified', function() {
  return browserify([
        'src/rsb.js',
        'src/main.js'
      ],  {
        debug: !production,
      })
      .bundle()
      .pipe(source('kognijs.rsb.js'))
      .pipe(buffer())
      .pipe(gulp.dest('redist/'));
}));

gulp.task('build-tour', function () {

  var b = browserify([
      'src/rsb.js',
      'src/main.js'
  ], {
    debug: !production
  });

  getNPMPackageIds().forEach(function (id) {
    b.external(id);
  });

  var stream = b.bundle().pipe(source('kogni.rsb.tour.js'));
  stream.pipe(gulp.dest('./dist'));

  return stream;
});


gulp.task('serve', gulp.series('build-vendor', 'build-tour', 'browser-sync', function () {
  gulp.watch('src/**/*.js', ['build-tour', reload]);
  gulp.watch('examples/*.html', reload);
}));

gulp.task('default', gulp.parallel('serve'));

function getNPMPackageIds() {
  var packageManifest = {};
  try {
    packageManifest = require('./package.json');
  } catch (e) {
    console.log('ERROR:', e)
  }
  return _.keys(packageManifest.dependencies) || [];
}
