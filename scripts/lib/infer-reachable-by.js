/**
 * Infer travel_access.reachable_by for a destination (car | bus | train | flight).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var CONFIG_PATH = path.join(__dirname, '..', '..', 'database', 'recommendation', 'config.json');
var VALID_MODES = ['car', 'bus', 'train', 'flight'];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function slugPart(slug, token) {
  return slug && slug.indexOf(token) !== -1;
}

function loadRules() {
  var cfg = readJson(CONFIG_PATH);
  var rules = cfg.travel_access_rules || {};
  return {
    flightOnlyStates: rules.flight_only_from_mainland_states || ['Andaman and Nicobar Islands', 'Lakshadweep'],
    gatewaySlugTokens: rules.gateway_slug_tokens || ['port-blair', 'kavaratti', 'agatti'],
    noRailStates: rules.no_rail_states || ['Ladakh', 'Andaman and Nicobar Islands', 'Lakshadweep']
  };
}

function parseGetInOptions(options) {
  var modes = {};
  (options || []).forEach(function (opt) {
    var o = String(opt).toLowerCase().trim();
    if (!o) return;
    if (o === 'plane' || o.indexOf('flight') !== -1 || o.indexOf('helicopter') !== -1) modes.flight = true;
    if (o === 'bus' || o.indexOf('bus') !== -1) modes.bus = true;
    if (o === 'car' || o === 'road' || o.indexOf('car') !== -1 || o.indexOf('taxi') !== -1 || o.indexOf('motor') !== -1) modes.car = true;
    if (o === 'train' || o.indexOf('train') !== -1 || o === 'rail') modes.train = true;
  });
  return modes;
}

function parseGetInBrief(brief) {
  var modes = {};
  if (!brief) return modes;
  var b = String(brief);
  var bl = b.toLowerCase();

  if (/by plane|by flight|\biata\b|airport|flights? (from|to)/i.test(b)) modes.flight = true;
  if (/by train|\brail\b|railway station|himsagar|rajdhani|shatabdi/i.test(b) && !/no train|without train|not.*train|no rail/i.test(bl)) {
    modes.train = true;
  }
  if (/by bus|state transport|hrtc|hptdc|ksrtc|apsrtc|msrtc|upsrtc|rtc bus|government bus/i.test(b)) modes.bus = true;
  if (/by (car|road|taxi|highway|motorbike|motorcycle|tempo traveller)|manali-leh|srinagar-leh|national highway|\bnh\d/i.test(b)) {
    modes.car = true;
  }
  if (/only option.*(winter|plane|flight)|planes fly|only flights?/i.test(b)) modes.flight = true;
  if (/no buses serve|no bus service|no train|no railway|no rail network|not connected by rail/i.test(bl)) {
    delete modes.train;
    delete modes.bus;
  }
  if (/ferry|catamaran|boat only|ships? (from|to)|only by boat/i.test(bl) && !modes.flight) {
    delete modes.car;
    delete modes.bus;
    delete modes.train;
  }

  return modes;
}

function isGatewayDest(slug, rules) {
  if (!slug) return false;
  for (var i = 0; i < rules.gatewaySlugTokens.length; i++) {
    if (slugPart(slug, rules.gatewaySlugTokens[i])) return true;
  }
  return false;
}

function inferReachableBy(dest, stateName, rulesIn) {
  var rules = rulesIn || loadRules();
  var slug = dest.slug || '';
  var ta = dest.travel_access || {};
  var modes = {};

  function add(m) { if (VALID_MODES.indexOf(m) !== -1) modes[m] = true; }
  function merge(obj) {
    Object.keys(obj || {}).forEach(function (k) { if (obj[k]) add(k); });
  }

  if (rules.flightOnlyStates.indexOf(stateName) !== -1) {
    if (isGatewayDest(slug, rules)) {
      add('flight');
      add('bus');
      add('car');
      return VALID_MODES.filter(function (m) { return modes[m]; });
    }
    return ['flight'];
  }

  var gi = dest.section_briefs && dest.section_briefs.get_in;
  merge(parseGetInOptions(gi && gi.options));
  merge(parseGetInBrief(gi && gi.brief));
  merge(parseGetInBrief(dest.description));

  if (ta.nearest_airport && ta.nearest_airport.code) {
    if (ta.nearest_airport.note && /reach via flight|flight to port blair|then ferry/i.test(String(ta.nearest_airport.note).toLowerCase())) {
      return ['flight'];
    }
    add('flight');
  }

  if (ta.nearest_railway_station && ta.nearest_railway_station.name) add('train');
  if (ta.direct_train_available_from_major_cities && ta.direct_train_available_from_major_cities.length) add('train');

  if (ta.road_access_quality === 'island_ferry_or_road' || ta.ferry_hub) {
    return ['flight'];
  }

  if (rules.noRailStates.indexOf(stateName) !== -1) delete modes.train;

  if (stateName === 'Ladakh') {
    add('flight');
    add('bus');
    add('car');
    delete modes.train;
  }

  var giBrief = (gi && gi.brief) || '';
  if (/no buses serve this region/i.test(giBrief)) delete modes.bus;

  if (!Object.keys(modes).length) {
    add('car');
    add('bus');
    if (rules.noRailStates.indexOf(stateName) === -1) add('train');
  }

  return VALID_MODES.filter(function (m) { return modes[m]; });
}

module.exports = {
  VALID_MODES: VALID_MODES,
  loadRules: loadRules,
  inferReachableBy: inferReachableBy
};
