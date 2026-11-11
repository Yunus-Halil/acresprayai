// The analysis record's switch, file name and limits (see analysis.ts), kept apart from the record's code so the
// pages that save it do not load the corn engine to learn a file name. Nothing is imported here: the build's worker
// reads this file too. Who gets a record is decided in analysisAccess.ts.

/** The record's file in the twin's folder (gzipped JSON). */
export const TWIN_ANALYSIS_FILE = "analysis.json.gz";
/** The one switch: false and no build makes a record, nothing is saved and nothing waiting is sent. */
export const TWIN_ANALYSIS_ENABLED = true;
/** A record larger than this, gzipped, is not saved (400 photographs measure 1 to 2.6 MB; every photograph at the plant cap would be 27 MB). */
export const TWIN_ANALYSIS_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The versions of the pilot terms that tell a participant about the record (what it holds, that it is saved beside
 * the twin, that a copy may wait on their device): src/pages/PilotTerms.tsx, "The analysis record of a corn Field
 * Twin". A participant's build makes one only when the terms in force are listed here, are approved (TERMS_APPROVED),
 * and are the version that participant agreed to. A later version must carry the section to be listed.
 */
export const TERMS_DISCLOSING_ANALYSIS: readonly string[] = ["pilot-2026-11-v2"];

// ---- the records waiting on the device (analysisOutbox.ts) -------------------------------------------------------
/** A record that has not reached the account after this long is dropped from the device. */
export const ANALYSIS_PENDING_MAX_AGE_MS = 7 * 24 * 3_600_000;
/** At most this many records wait on one device, and this many bytes together; the oldest go first. */
export const ANALYSIS_PENDING_MAX_ENTRIES = 5;
export const ANALYSIS_PENDING_MAX_BYTES = 20 * 1024 * 1024;
/** A record the account's storage refused this many times is dropped. */
export const ANALYSIS_PENDING_MAX_ATTEMPTS = 8;
/** A record tried this recently is an upload still under way (this tab's, or another's): left alone. */
export const ANALYSIS_PENDING_QUIET_MS = 2 * 60_000;
