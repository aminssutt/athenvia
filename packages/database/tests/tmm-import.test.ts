import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapTmmRecord,
  planTmmImport,
  TMM_UNIVERSITY_VARIANTS,
  type TmmRecord,
} from "../src/tmm-import";

function record(overrides: Partial<TmmRecord> = {}): TmmRecord {
  return {
    annee: "2021",
    etab_uai: "0251215K",
    etab_nom: "Université de Besançon",
    etab_ville: "BESANCON",
    for_intitule: "Français langue étrangère",
    parc_intitule: "Métiers du FLE, ingénierie de la formation",
    for_dom: "ARTS, LETTRES, LANGUES",
    for_lien_fiche: "http://formation.univ-fcomte.fr/master/fle",
    ...overrides,
  };
}

describe("mapTmmRecord", () => {
  it("maps a parcours row to an importable programme", () => {
    const candidate = mapTmmRecord(record());
    assert.ok(candidate);
    assert.equal(candidate.universityName, "Université de Besançon");
    assert.equal(candidate.normalizedUniversityName, "universite de besancon");
    assert.equal(candidate.city, "Besancon");
    assert.equal(
      candidate.programName,
      "Français langue étrangère – Métiers du FLE, ingénierie de la formation",
    );
    assert.equal(candidate.officialUrl, "http://formation.univ-fcomte.fr/master/fle");
    assert.equal(candidate.domainSlug, "arts-humanities-languages");
  });

  it("rejects rows without an establishment or any programme title", () => {
    assert.equal(mapTmmRecord(record({ etab_nom: "  " })), null);
    assert.equal(mapTmmRecord(record({ for_intitule: null, parc_intitule: null })), null);
  });

  it("collapses identical mention and parcours titles", () => {
    const candidate = mapTmmRecord(
      record({ for_intitule: "Droit notarial", parc_intitule: "Droit Notarial" }),
    );
    assert.ok(candidate);
    assert.equal(candidate.programName, "Droit notarial");
  });

  it("drops malformed fiche links instead of importing them", () => {
    const candidate = mapTmmRecord(record({ for_lien_fiche: "not a link" }));
    assert.ok(candidate);
    assert.equal(candidate.officialUrl, null);
  });
});

describe("planTmmImport", () => {
  it("matches existing universities by name or alias and creates the rest", () => {
    const besancon = mapTmmRecord(record());
    const aliased = mapTmmRecord(
      record({ etab_uai: "0755976N", etab_nom: "Sorbonne Université", parc_intitule: "Physique" }),
    );
    const unknown = mapTmmRecord(
      record({ etab_uai: "0000000A", etab_nom: "Institut Inconnu", parc_intitule: "Histoire" }),
    );
    assert.ok(besancon && aliased && unknown);

    const plan = planTmmImport(
      [besancon, aliased, unknown],
      [{ id: "11111111-1111-4111-8111-111111111111", normalizedName: "universite de besancon" }],
      new Map([["sorbonne universite", "22222222-2222-4222-8222-222222222222"]]),
    );

    assert.equal(plan.matchedUniversities, 2);
    assert.equal(plan.newUniversities.length, 1);
    assert.equal(plan.newUniversities[0]!.name, "Institut Inconnu");
    assert.equal(plan.programs.length, 3);
    assert.ok(
      plan.programs.some(
        (program) => program.universityId === "22222222-2222-4222-8222-222222222222",
      ),
    );
  });

  it("deduplicates parcours on the programme natural key with stable identities", () => {
    const first = mapTmmRecord(record());
    const duplicate = mapTmmRecord(record({ etab_ville: "BESANÇON" }));
    assert.ok(first && duplicate);

    const planA = planTmmImport([first, duplicate], [], new Map());
    const planB = planTmmImport([first], [], new Map());

    assert.equal(planA.programs.length, 1);
    assert.equal(planA.skippedDuplicates, 1);
    assert.equal(planA.programs[0]!.id, planB.programs[0]!.id);
  });
});

describe("TMM university variants", () => {
  it("matches historical numbered names onto their canonical universities", () => {
    const nanterre = mapTmmRecord(
      record({ etab_uai: "0921204J", etab_nom: "Université Paris-X", parc_intitule: "Histoire" }),
    );
    assert.ok(nanterre);
    const plan = planTmmImport(
      [nanterre],
      [
        { id: "33333333-3333-4333-8333-333333333333", normalizedName: "universite paris nanterre" },
        { id: "44444444-4444-4444-8444-444444444444", normalizedName: "universite paris xii" },
      ],
      new Map(),
    );
    assert.equal(plan.newUniversities.length, 0);
    assert.equal(plan.programs[0]!.universityId, "33333333-3333-4333-8333-333333333333");
  });

  it("never maps distinct numbered universities onto each other", () => {
    assert.equal(
      TMM_UNIVERSITY_VARIANTS.get("universite paris xii"),
      "Université Paris-Est Créteil",
    );
    assert.equal(TMM_UNIVERSITY_VARIANTS.get("universite toulouse iii"), undefined);
    assert.equal(TMM_UNIVERSITY_VARIANTS.get("universite de besancon"), undefined);
  });
});
