/**
 * Client-safe constants shared by the server page and the browser views.
 */

/** The public website that publishes the forecasts, standings and method pages. */
export const SITE_URL = "https://thedatadriver.app";

/** Interactive API reference published by the website. */
export const API_DOCS_URL = `${SITE_URL}/api-docs`;

/**
 * The season the Lab opens on and labels "live". Bump it when the API
 * publishes a new season's calendar; earlier seasons stay in the selector.
 */
export const LIVE_SEASON = 2026;

/** Source repository of this application (shown in the header and footer). */
export const REPO_URL = process.env.NEXT_PUBLIC_TDD_REPO_URL || "https://github.com/thejoyfulist/the-data-driver-lab";
