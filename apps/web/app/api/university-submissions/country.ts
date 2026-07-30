const ISO_ALPHA_2_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN
BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL
GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP
NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD
SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`
  .trim()
  .split(/\s+/);

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  america: "US",
  bolivia: "BO",
  brunei: "BN",
  "cape verde": "CV",
  "czech republic": "CZ",
  england: "GB",
  "great britain": "GB",
  iran: "IR",
  "ivory coast": "CI",
  kosovo: "XK",
  laos: "LA",
  macedonia: "MK",
  micronesia: "FM",
  moldova: "MD",
  "north korea": "KP",
  palestine: "PS",
  russia: "RU",
  "south korea": "KR",
  swaziland: "SZ",
  syria: "SY",
  taiwan: "TW",
  tanzania: "TZ",
  "the netherlands": "NL",
  "united states of america": "US",
  "u k": "GB",
  uk: "GB",
  "u s": "US",
  usa: "US",
  venezuela: "VE",
  "viet nam": "VN",
  vietnam: "VN",
};

function normalizeCountryName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function buildCountryNames() {
  const names = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

  for (const code of ISO_ALPHA_2_CODES) {
    names.set(normalizeCountryName(code), code);
    const displayName = displayNames.of(code);
    if (displayName) {
      names.set(normalizeCountryName(displayName), code);
    }
  }

  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    names.set(normalizeCountryName(alias), code);
  }

  return names;
}

const countryNames = buildCountryNames();

export function resolveCountryCode(country: string): string | null {
  return countryNames.get(normalizeCountryName(country)) ?? null;
}
