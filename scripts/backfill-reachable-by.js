/**
 * Backfill travel_access.reachable_by for all destination JSON files.
 * Values match profile travel modes: car | bus | train | flight
 *
 * Run: node scripts/backfill-reachable-by.js
 *      node scripts/backfill-reachable-by.js --dry-run
 */

'use strict';

var fs = require('fs');
var path = require('path');

var DEST_DIR = path.join(__dirname, '..', 'database', 'destinations', 'in');
var CONFIG_PATH = path.join(__dirname, '..', 'database', 'recommendation', 'config.json');
var inferReachable = require('./lib/infer-reachable-by');

var VALID_MODES = inferReachable.VALID_MODES;

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8'); }

function slugPart(slug, token) {
  return slug && slug.indexOf(token) !== -1;
}

function loadRules() {
  return inferReachable.loadRules();
}

function inferReachableBy(dest, stateName, rules) {
  return inferReachable.inferReachableBy(dest, stateName, rules);
}

function main() {
  var dryRun = process.argv.indexOf('--dry-run') !== -1;
  var rules = loadRules();
  var files = fs.readdirSync(DEST_DIR).filter(function (f) { return f.endsWith('.json'); });
  var stats = { files: 0, destinations: 0, samples: [] };

  files.forEach(function (file) {
    var filePath = path.join(DEST_DIR, file);
    var doc = readJson(filePath);
    var stateName = doc.state || file.replace(/\.json$/, '').replace(/_/g, ' ');
    var changed = 0;

    (doc.destinations || []).forEach(function (dest) {
      stats.destinations++;
      if (!dest.travel_access) dest.travel_access = {};
      var inferred = inferReachableBy(dest, dest.state || stateName, rules);
      var prev = dest.travel_access.reachable_by;
      var same = prev && prev.length === inferred.length && prev.every(function (m, i) { return m === inferred[i]; });
      if (!same) {
        dest.travel_access.reachable_by = inferred;
        changed++;
        if (stats.samples.length < 8 && (slugPart(dest.slug, 'leh') || slugPart(dest.slug, 'havelock') || slugPart(dest.slug, 'goa-'))) {
          stats.samples.push({ name: dest.name, state: dest.state, reachable_by: inferred });
        }
      }
    });

    if (changed && !dryRun) writeJson(filePath, doc);
    stats.files++;
  });

  console.log('[backfill-reachable-by]', dryRun ? 'DRY RUN' : 'WROTE', stats);
}

main();
