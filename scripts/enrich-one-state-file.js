/**
 * Deep-enrich a single database/destinations/in/*.json file.
 * Usage: node scripts/enrich-one-state-file.js Andaman_and_Nicobar_Islands.json
 */

'use strict';

var fs = require('fs');
var path = require('path');
var https = require('https');

var ROOT = path.join(__dirname, '..');
var DEST_DIR = path.join(ROOT, 'database', 'destinations', 'in');
var CONFIG_PATH = path.join(ROOT, 'database', 'recommendation', 'config.json');

var ANDAMAN_PEAK_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5];
var ANDAMAN_MONSOON_MONTHS = [6, 7, 8, 9];
var ANDAMAN_BEST_TEXT = 'Oct–May (clear seas; avoid monsoon Jun–Sep)';
var IXZ = {
  name: 'Veer Savarkar International Airport (Port Blair)',
  code: 'IXZ'
};
var FLIGHT_HUBS = ['Chennai', 'Delhi', 'Kolkata', 'Hyderabad', 'Visakhapatnam', 'Bengaluru'];

var SEGMENT_LABELS = {
  beach: 'Beach / Coastal',
  mountain: 'Mountain / Hills',
  heritage: 'Heritage / Culture',
  wildlife: 'Wildlife / Nature',
  city: 'City / Urban',
  spiritual: 'Spiritual / Pilgrimage'
};
var FORMAL_CATEGORIES = {
  beach: ['beaches'],
  mountain: ['mountains', 'mountain'],
  heritage: ['historic sites', 'heritage'],
  wildlife: ['nature & wildlife areas', 'nature', 'wildlife'],
  city: ['points of interest & landmarks', 'city'],
  spiritual: ['religious sites', 'religious', 'spiritual', 'pilgrimage']
};
var SEGMENT_ORDER = ['spiritual', 'heritage', 'wildlife', 'beach', 'mountain', 'city'];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8'); }

function collectCategoryStrings(raw) {
  var out = [];
  var seen = {};
  function add(v) {
    if (v == null || v === '') return;
    if (Array.isArray(v)) return v.forEach(add);
    var t = String(v).trim();
    if (!t) return;
    var k = t.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(t);
  }
  add(raw.categories);
  add(raw.category);
  return out;
}

function metaBlobLower(raw) {
  var parts = collectCategoryStrings(raw);
  if (raw.vibe) parts.push(String(raw.vibe));
  return parts.join(' ').toLowerCase();
}

function spiritualContextLower(raw) {
  var parts = [metaBlobLower(raw)];
  if (raw.name) parts.push(String(raw.name));
  if (raw.description) {
    parts.push(String(raw.description).replace(/\*\*([^*]+)\*\*/g, '$1').slice(0, 900));
  }
  var sb = raw.section_briefs;
  if (sb && sb.understand && sb.understand.brief) parts.push(String(sb.understand.brief));
  return parts.join(' ').toLowerCase();
}

function matchesSegment(chip, raw, config) {
  var narrow = metaBlobLower(raw);
  var label = SEGMENT_LABELS[chip];
  if (label && narrow.indexOf(label.toLowerCase()) !== -1) return true;
  var formal = FORMAL_CATEGORIES[chip] || [];
  for (var f = 0; f < formal.length; f++) {
    if (narrow.indexOf(formal[f]) !== -1) return true;
  }
  var segs = (config && config.destination_segments) || {};
  if (chip === 'spiritual') {
    var strong = config.spiritual_filter_strong_keywords || [];
    var ctx = spiritualContextLower(raw);
    for (var si = 0; si < strong.length; si++) {
      if (ctx.indexOf(String(strong[si]).toLowerCase()) !== -1) return true;
    }
    var spiritKw = segs.spiritual || [];
    for (var wi = 0; wi < spiritKw.length; wi++) {
      if (narrow.indexOf(String(spiritKw[wi]).toLowerCase()) !== -1) return true;
    }
    return false;
  }
  var kwList = segs[chip];
  if (kwList && kwList.length) {
    for (var ki = 0; ki < kwList.length; ki++) {
      if (narrow.indexOf(String(kwList[ki]).toLowerCase()) !== -1) return true;
    }
  }
  return false;
}

function inferCategories(raw, config) {
  var labels = [];
  for (var i = 0; i < SEGMENT_ORDER.length; i++) {
    if (matchesSegment(SEGMENT_ORDER[i], raw, config)) labels.push(SEGMENT_LABELS[SEGMENT_ORDER[i]]);
  }
  return labels;
}

function wikiTitleFromUrl(url) {
  if (!url) return null;
  var m = String(url).match(/wikipedia\.org\/wiki\/([^#?]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/_/g, ' ')); } catch (e) { return m[1].replace(/_/g, ' '); }
}

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'HolidayHacker-Enrich/1.0' } }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function plainText(s) {
  return String(s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchContext(dest) {
  var parts = [];
  if (dest.categories && dest.categories.length) parts.push(dest.categories.join(' '));
  parts.push(dest.name || '');
  if (dest.alt_names && dest.alt_names.length) parts.push(dest.alt_names.join(' '));
  if (dest.vibe) parts.push(dest.vibe);
  if (dest.enrichment && dest.enrichment.wikipedia_summary) parts.push(dest.enrichment.wikipedia_summary);
  var sb = dest.section_briefs;
  if (sb && sb.understand && sb.understand.brief) parts.push(plainText(sb.understand.brief).slice(0, 400));
  if (dest.description) parts.push(plainText(dest.description).slice(0, 300));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeCategoryField(dest) {
  var c = String(dest.category || '').toLowerCase();
  if (c === 'beach') dest.category = 'Beaches';
  else if (c === 'city') dest.category = 'City';
  else if (c === 'destination') dest.category = 'Nature & Wildlife Areas';
}

function applyClimate(dest) {
  if (!dest.climate_profile) {
    dest.climate_profile = {
      peak_season_months: ANDAMAN_PEAK_MONTHS.slice(),
      off_season_months: ANDAMAN_MONSOON_MONTHS.slice(),
      monsoon_months: ANDAMAN_MONSOON_MONTHS.slice(),
      avoid_months: [7, 8],
      average_temp_range_celsius: { summer: '24–32', winter: '22–30' }
    };
  } else {
    if (!dest.climate_profile.peak_season_months || !dest.climate_profile.peak_season_months.length) {
      dest.climate_profile.peak_season_months = ANDAMAN_PEAK_MONTHS.slice();
    }
    if (!dest.climate_profile.monsoon_months || !dest.climate_profile.monsoon_months.length) {
      dest.climate_profile.monsoon_months = ANDAMAN_MONSOON_MONTHS.slice();
    }
  }
  dest.best_time_to_visit = {
    text: ANDAMAN_BEST_TEXT,
    months: ANDAMAN_PEAK_MONTHS.slice(),
    season: 'dry_winter_spring'
  };
  dest.ideal_months = ANDAMAN_PEAK_MONTHS.slice();
  dest.weather_snippet = 'Oct–May';
  if (dest.crowd_profile) dest.crowd_profile.peak_crowd_months = [12, 1, 2, 3];
}

function applyTravelAccess(dest) {
  if (!dest.travel_access) dest.travel_access = {};
  var ta = dest.travel_access;
  var isPortBlair = dest.slug && dest.slug.indexOf('port-blair') !== -1;
  if (isPortBlair) {
    ta.nearest_airport = { name: 'Veer Savarkar International Airport', code: 'IXZ', distance_km: 2 };
    ta.direct_flight_available_from_major_cities = FLIGHT_HUBS.slice();
    ta.access_note = 'Main gateway to the Andaman & Nicobar Islands; inter-island ferries and catamarans from Phoenix Bay / Haddo jetties.';
  } else {
    ta.nearest_airport = {
      name: IXZ.name,
      code: IXZ.code,
      distance_km: null,
      note: 'Reach via flight to Port Blair (IXZ), then ferry or road as applicable'
    };
    ta.nearest_railway_station = { name: null, distance_km: null, note: 'No rail network on the islands' };
    if (!ta.direct_flight_available_from_major_cities || !ta.direct_flight_available_from_major_cities.length) {
      ta.direct_flight_available_from_major_cities = FLIGHT_HUBS.slice();
    }
    ta.ferry_hub = 'Port Blair';
    if (!ta.road_access_quality) ta.road_access_quality = 'island_ferry_or_road';
  }
}

function applyDestinationSpecific(dest) {
  var slug = dest.slug || '';
  dest._indiaRegion = 'South';

  if (slug.indexOf('port-blair') !== -1) {
    dest.categories = ['City / Urban', 'Heritage / Culture'];
    dest.alt_names = ['Sri Vijaya Puram', 'Port Blair'];
    dest.images = (dest.images || []).filter(function (img) {
      return img.url && img.url.indexOf('Chaeronea') === -1 && img.url.indexOf('Battle') === -1;
    });
    if (dest.safety_profile) dest.safety_profile.has_medical_facilities_nearby = true;
    dest.credibility_recognitions = dest.credibility_recognitions || [];
    if (dest.credibility_recognitions.indexOf('asi_monument') === -1) {
      dest.credibility_recognitions.push('asi_monument');
    }
  }

  if (slug.indexOf('havelock') !== -1) {
    dest.categories = ['Beach / Coastal', 'Wildlife / Nature'];
    dest.alt_names = ['Swaraj Dweep', 'Havelock Island'];
    dest.activity_profile = dest.activity_profile || {};
    dest.activity_profile.primary_activities = ['beach', 'scuba_diving', 'snorkeling', 'relaxation'];
    dest.activity_profile.requires_advance_booking = true;
    dest.highlights = ['Radhanagar Beach', 'Elephant Beach', 'Kalapathar Beach', 'Scuba diving'];
  }

  if (slug.indexOf('neil-island') !== -1) {
    dest.categories = ['Beach / Coastal'];
    dest.alt_names = ['Shaheed Dweep', 'Neill Island', 'Neil Island'];
    dest.highlights = ['Bharatpur Beach', 'Laxmanpur Beach', 'Natural Bridge'];
  }

  if (slug.indexOf('baratang') !== -1) {
    dest.categories = ['Wildlife / Nature', 'Beach / Coastal'];
    dest.highlights = ['Limestone Caves', 'Mud Volcano', 'Parrot Island', 'Jarawa Reserve Forest (transit only)'];
    if (dest.safety_profile) dest.safety_profile.wildlife_caution = true;
  }

  if (slug.indexOf('jarwa') !== -1) {
    dest.categories = ['Wildlife / Nature'];
    if (dest.safety_profile) {
      dest.safety_profile.wildlife_caution = true;
      dest.safety_profile.requires_permit = true;
    }
  }

  if (slug.indexOf('mahatma-gandhi-marine') !== -1) {
    dest.categories = ['Wildlife / Nature', 'Beach / Coastal'];
    dest.category = 'Nature & Wildlife Areas';
    dest.credibility_recognitions = ['national_park'];
    dest.highlights = ['Jolly Buoy Island', 'Red Skin Island', 'Snorkelling', 'Glass-bottom boats'];
    if (dest.safety_profile) dest.safety_profile.requires_permit = true;
  }

  if (slug.indexOf('ross-island') !== -1 || slug.indexOf('smith-and-ross') !== -1) {
    dest.categories = ['Heritage / Culture', 'Wildlife / Nature'];
    dest.highlights = ['British colonial ruins', 'Peacocks', 'Light & sound show'];
  }

  if (slug.indexOf('wandoor') !== -1) {
    dest.categories = ['Wildlife / Nature', 'Beach / Coastal'];
    dest.highlights = ['Mahatma Gandhi Marine National Park gateway', 'Jolly Buoy boats'];
  }

  if (slug.indexOf('diglipur') !== -1) {
    dest.categories = ['Wildlife / Nature', 'Beach / Coastal'];
    dest.highlights = ['Ross & Smith twin islands', 'Saddle Peak', 'Turtle nesting (seasonal)'];
    dest.recommended_max_days = dest.recommended_max_days || 4;
  }

  if (slug.indexOf('barren-island') !== -1) {
    dest.categories = ['Wildlife / Nature'];
    dest.highlights = ['India\'s only active volcano', 'Boat tours only'];
    dest.min_days = Math.max(dest.min_days || 1, 2);
  }

  if (slug.indexOf('little-andaman') !== -1) {
    dest.categories = ['Beach / Coastal', 'Wildlife / Nature'];
    dest.highlights = ['Butler Bay Beach', 'Waterfalls', 'Surfing (seasonal)'];
  }

  if (slug.indexOf('long-island') !== -1) {
    dest.categories = ['Beach / Coastal', 'Wildlife / Nature'];
  }

  if (slug.indexOf('rangat') !== -1) {
    dest.categories = ['Wildlife / Nature', 'Beach / Coastal'];
  }

  if (slug.indexOf('cinque') !== -1 || slug.indexOf('narcondam') !== -1) {
    dest.categories = ['Wildlife / Nature'];
    if (dest.safety_profile) dest.safety_profile.requires_permit = true;
  }

  if (!dest.categories || !dest.categories.length) {
    dest.categories = inferCategories(dest, readJson(CONFIG_PATH));
  }
  if (!dest.categories.length && dest.category === 'Beaches') {
    dest.categories = ['Beach / Coastal'];
  }
}

async function main() {
  var fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/enrich-one-state-file.js <filename.json>');
    process.exit(1);
  }
  var filePath = path.join(DEST_DIR, fileArg);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  var config = readJson(CONFIG_PATH);
  var doc = readJson(filePath);
  var stats = { destinations: 0, wiki: 0, wikiFail: 0 };

  doc.state_enrichment = {
    union_territory: true,
    region: 'South',
    gateway_city: 'Port Blair',
    gateway_airport_iata: 'IXZ',
    best_time_to_visit: ANDAMAN_BEST_TEXT,
    peak_months: ANDAMAN_PEAK_MONTHS,
    monsoon_months: ANDAMAN_MONSOON_MONTHS,
    permits_note: 'Indian nationals: RAP generally not required for main tourist islands. Restricted/tribal areas and some islets need forest permits.',
    enriched_at: new Date().toISOString()
  };

  for (var i = 0; i < (doc.destinations || []).length; i++) {
    var dest = doc.destinations[i];
    stats.destinations++;
    normalizeCategoryField(dest);
    applyClimate(dest);
    applyTravelAccess(dest);
    applyDestinationSpecific(dest);
    if (!dest.travel_access) dest.travel_access = {};
    try {
      var inferMod = require('./lib/infer-reachable-by');
      dest.travel_access.reachable_by = inferMod.inferReachableBy(dest, doc.state || dest.state);
    } catch (e) { /* optional */ }

    if (!dest.categories || !dest.categories.length) {
      dest.categories = inferCategories(dest, config);
    }

    if (!dest.enrichment) dest.enrichment = {};
    dest.enrichment.auto_categorized_at = new Date().toISOString();
    dest.enrichment.source_region = 'Andaman and Nicobar Islands batch enrich';

    if (dest.links && dest.links.wikipedia) {
      var title = wikiTitleFromUrl(dest.links.wikipedia);
      if (title) {
        try {
          var summary = await fetchJson(
            'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'))
          );
          if (summary.extract) {
            dest.enrichment.wikipedia_summary = summary.extract;
            dest.enrichment.wikipedia_description = summary.description || null;
            dest.enrichment.wikipedia_thumbnail = summary.thumbnail && summary.thumbnail.source ? summary.thumbnail.source : null;
            dest.enrichment.wikipedia_fetched_at = new Date().toISOString();
            if (summary.thumbnail && summary.thumbnail.source) {
              var hasThumb = (dest.images || []).some(function (img) {
                return img.url && img.url.indexOf('width=1024') !== -1;
              });
              if (!hasThumb) {
                dest.images = dest.images || [];
                dest.images.unshift({
                  url: summary.thumbnail.source,
                  caption: summary.title || dest.name,
                  source: 'wikipedia_rest'
                });
              }
            }
            stats.wiki++;
          }
        } catch (e) {
          stats.wikiFail++;
        }
        await sleep(200);
      }
    }

    dest.search_context = buildSearchContext(dest);
    if (dest.metadata) {
      dest.metadata.last_verified = new Date().toISOString().slice(0, 10);
      dest.metadata.quality_score = Math.min(1, (dest.metadata.quality_score || 0.5) + 0.15);
    }
  }

  doc.count = doc.destinations.length;
  doc.generated_at = new Date().toISOString();
  writeJson(filePath, doc);
  console.log('[enrich-one-state-file]', fileArg, stats);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
