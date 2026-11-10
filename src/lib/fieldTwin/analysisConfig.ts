// The analysis record's switch and file name (see analysis.ts), kept apart from the record's code so the pages that
// save it do not load the corn engine to learn a file name.

/** The record's file in the twin's folder (gzipped JSON). */
export const TWIN_ANALYSIS_FILE = "analysis.json.gz";
/** Off until the founder says so: no build makes the record and nothing is saved. */
export const TWIN_ANALYSIS_ENABLED = false;
/** A record larger than this, gzipped, is not saved (400 photographs measure 1 to 2.6 MB; every photograph at the plant cap would be 27 MB). */
export const TWIN_ANALYSIS_MAX_BYTES = 8 * 1024 * 1024;
