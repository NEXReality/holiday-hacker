/**
 * Second-pass fixes for Andaman_and_Nicobar_Islands.json after bulk enrich.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '..', 'database', 'destinations', 'in', 'Andaman_and_Nicobar_Islands.json');

function plainText(s) {
  return String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
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
  if (dest.highlights && dest.highlights.length) parts.push(dest.highlights.join(' '));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function bySlug(doc, slugPart) {
  return doc.destinations.find(function (d) { return d.slug && d.slug.indexOf(slugPart) !== -1; });
}

var GARBAGE_ALT = /magadi|adakamaranahalli|aladakatte|jediná|barrenov otok|ilha |đảo |île /i;

function sanitizeAltNames(names) {
  if (!names || !names.length) return [];
  return names.filter(function (n) {
    var t = String(n).trim();
    if (!t || t.length > 60) return false;
    if (GARBAGE_ALT.test(t)) return false;
    return true;
  });
}

var doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));

doc.destinations.forEach(function (dest) {
  dest.alt_names = sanitizeAltNames(dest.alt_names);
});

var baratang = bySlug(doc, 'baratang');
if (baratang) baratang.alt_names = ['Baratang Island'];

var diglipur = bySlug(doc, 'diglipur');
if (diglipur) diglipur.alt_names = [];

var rangat = bySlug(doc, 'rangat');
if (rangat) {
  rangat.alt_names = [];
  rangat.highlights = ['Panchavati waterfall', 'Amkunj Beach', 'Cuthbert Bay turtle nesting (Dec–Feb)'];
}

var barren = bySlug(doc, 'barren');
if (barren) barren.alt_names = [];

var ross = bySlug(doc, 'ross-island');
if (ross && ross.slug.indexOf('smith') === -1) {
  ross.links.wikipedia = 'https://en.wikipedia.org/wiki/Netaji_Subhash_Chandra_Bose_Island';
  ross.description = '**Ross Island** (officially **Netaji Subhash Chandra Bose Island**) is a small island near Port Blair with British colonial ruins, peacocks, and a popular light-and-sound show. Day trips by ferry from the Water Sports Complex.';
  ross.alt_names = ['Netaji Subhash Chandra Bose Island'];
  ross.enrichment = ross.enrichment || {};
  ross.enrichment.wikipedia_summary = 'Ross Island, officially named Netaji Subhash Chandra Bose Island, is an island of the Andaman Islands. It belongs to the South Andaman administrative district, part of the Indian union territory of Andaman and Nicobar Islands. The island is situated 3 km (2 mi) east from central Port Blair.';
  ross.enrichment.wikipedia_fetched_at = new Date().toISOString();
  ross.enrichment.wikipedia_source = 'manual_title_override';
  if (!ross.section_briefs || !Object.keys(ross.section_briefs).length) {
    ross.section_briefs = {
      get_in: {
        brief: 'Ferry from Rajiv Gandhi Water Sports Complex, Port Blair (~15 min). Combined Ross + North Bay boat tours are common.',
        source: 'wikivoyage_parent'
      },
      see: {
        brief: 'British-era church, bakery, and administrative buildings overgrown by banyan trees; deer and peacocks roam freely. Evening light-and-sound show on the Cellular Jail history.',
        source: 'wikivoyage_parent'
      }
    };
  }
  ross.search_context = buildSearchContext(ross);
}

var smithRoss = bySlug(doc, 'smith-and-ross');
if (smithRoss) {
  smithRoss.highlights = ['Ross & Smith twin sandbar', 'Ross Island lighthouse', 'Olive Ridley turtle nesting'];
  smithRoss.links.wikipedia = 'https://en.wikipedia.org/wiki/Smith_Island_(Andaman_Islands)';
  smithRoss.enrichment = smithRoss.enrichment || {};
  smithRoss.enrichment.wikipedia_summary = 'Smith and Ross Islands are a pair of islands off Diglipur in North Andaman, connected by a seasonal sandbar. Ross Island (North Andaman) has a lighthouse; Smith Island is known for Olive Ridley turtle nesting. Access is typically arranged from Diglipur and may require forest permits.';
  smithRoss.enrichment.wikipedia_fetched_at = new Date().toISOString();
  smithRoss.enrichment.wikipedia_source = 'manual_composite';
  smithRoss.search_context = buildSearchContext(smithRoss);
}

var jarwa = bySlug(doc, 'jarwa');
if (jarwa) {
  jarwa.enrichment = jarwa.enrichment || {};
  jarwa.enrichment.wikipedia_summary = 'The Jarwa Reserve Forest protects the Jarawa tribal reserve on Middle Andaman. The Andaman Trunk Road passes through a transit corridor; visiting or photographing the Jarawa is illegal and harmful to the community. Permits apply for road transit only.';
  jarwa.enrichment.wikipedia_fetched_at = new Date().toISOString();
  jarwa.enrichment.wikipedia_source = 'manual_from_wikivoyage';
  jarwa.enrichment.tourism_status = 'restricted_transit_only';
  jarwa.activity_profile.primary_activities = ['transit_corridor', 'nature_observation_from_vehicle'];
  jarwa.highlights = ['Jarawa Reserve Forest (transit only)', 'Limestone caves nearby via Baratang tours'];
  if (jarwa.climate_profile) {
    jarwa.climate_profile.off_season_months = [6, 7, 8, 9];
    jarwa.climate_profile.avoid_months = [7, 8];
    jarwa.climate_profile.average_temp_range_celsius = { summer: '24–32', winter: '22–30' };
  }
  jarwa.search_context = buildSearchContext(jarwa);
}

var wandoor = bySlug(doc, 'wandoor');
if (wandoor) {
  wandoor.links.wikipedia = null;
  wandoor.enrichment = wandoor.enrichment || {};
  wandoor.enrichment.wikipedia_summary = 'Wandoor is a village at the southern tip of South Andaman and the main gateway to Mahatma Gandhi Marine National Park. Boats depart for Jolly Buoy and Red Skin islands (open on alternating six-month schedules) for snorkelling and coral viewing.';
  wandoor.enrichment.wikipedia_fetched_at = new Date().toISOString();
  wandoor.enrichment.wikipedia_source = 'manual_from_wikivoyage';
  wandoor.highlights = ['Mahatma Gandhi Marine National Park gateway', 'Jolly Buoy Island boats', 'Red Skin Island (alternate season)'];
  wandoor.categories = ['Wildlife / Nature', 'Beach / Coastal'];
  wandoor.search_context = buildSearchContext(wandoor);
}

var portBlair = bySlug(doc, 'port-blair');
if (portBlair) {
  portBlair.highlights = ['Cellular Jail', 'Corbyn\'s Cove', 'Anthropological Museum', 'Ferry hub to Havelock & Neil'];
  portBlair.credibility_recognitions = portBlair.credibility_recognitions || [];
  if (portBlair.credibility_recognitions.indexOf('asi_monument') === -1) {
    portBlair.credibility_recognitions.push('asi_monument');
  }
  portBlair.search_context = buildSearchContext(portBlair);
}

doc.generated_at = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log('[patch-andaman] done');
