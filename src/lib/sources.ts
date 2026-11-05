import { kv } from './kv';

// Curated source words and phrases. Each was vetted against the dictionary
// to give a large, varied answer pool (see scripts/check-sources).
// Hand-picked words and phrases.
const CURATED: string[] = [
  'Extraordinary', 'Transformation', 'Congratulations', 'International', 'The great outdoors', 'Adventure awaits', 'Under the stars', 'Celebration', 'Masterpiece', 'Kaleidoscope', 'Thunderstorms', 'Marketplace', 'Constellation', 'Breakthrough', 'Wonderland', 'Explanation', 'Countryside', 'Watermelons', 'Spectacular', 'Daydreaming', 'Lighthouse keeper', 'Rainbow sherbet', 'Midnight snack', 'Northern lights', 'Treasure hunt', 'Pancake breakfast', 'Mountain climbing', 'Hot air balloon', 'Detective stories', 'Secret garden', 'Championship', 'Personalities', 'Unpredictable', 'Photographers', 'Adventurous', 'Interstellar', 'Strawberries', 'Mysterious', 'Grandparents', 'Orchestra',
];

// Everyday 9–14 letter words mined from the dictionary: each yields at least
// 180 common answers. Screened to drop grim, political, religious, medical,
// technical-jargon and awkward entries.
const MINED: string[] = 'Relationships Declarations Advertisements Considerations Considerable Considerably Relationship Underestimate Predominantly Precautions Misunderstands Regulations Consideration Supplementary Advertisement Personality Understandable Misunderstand Atmospheric Incorporates Considerate Administering Disturbance Representation Misunderstood Counterparts Forecasting Conversations Pedestrians Descriptions Simultaneously Understanding Constrained Establishments Comprehensible Coordinates Speculation Dictionaries Plastering Replacements Instrumental Establishment Recommendation Configurations Administrative Administered Circumstances Dissertation Presentation Responsibility Undergraduates Accomplished Representative Tremendously Counterexample Comparatively Infrastructure Professionals Unsatisfactory Contemplates Advertising Conversation Conservation Professional Sophisticated Uncomfortable Probabilities Description Predictions Alternatives Aforementioned Undesirable Observations Pedestrian Establishing Contemplating Complementary Incorporated Reservations Registration Corresponding Simultaneous Transported Broadcasting Spontaneously Acknowledges Transformed Unrealistic Introduces Departments Reductions Interactions Superficially Manipulates Administers Compensation Interruptions Inadvertently Improvements Proceedings Specifications Correspondent Impersonal Comprehensive Circumstance Generations Experimentally Abbreviations Opportunities Persuading Unnecessarily Complicates Pretentious Disappearing Alterations Comprehension Transmitted Miscellaneous Declaration Complications Accomplishes Predictable Questionable Performances Commentators Publications Established Questionnaire Resignation Thoroughfares Contributes Observation Operations Acknowledging Explanations Proliferation Satisfactorily Increasingly Leadership Manufacturers Reproduction Separating Expectations Electronically Separation Boundaries Administer Constructive Generalization Documentary Respectable Accomplishing Wholeheartedly Discourages Investigations Duplicates Signatures Contemplated Celebrating Atmosphere Scientifically Environmental Reservation Theoretically Thereabouts Supernatural Triangles Transferring Intersections Scattering Incompatible Investigated Reinstated Interactively Communicates Decreasing Documentation Approximately Particles Restrained Transmitters Unsupported Departmental Discontinues Interestingly Achievements Overloading Manufactures Prescription Misfortune Tremendous Mysteriously Technological Appointments Differential Specification Sophisticates Confidential Transporting Discouraged Compressing Periodically Contradicted Orchestral Originates Concentrates Temperatures Transforming Enthusiastic Standardizes Implications Congratulate Developments Misreading Supermarket Discovering Postmaster Constructed Encouragement Automobiles Undertakes Sophisticate Contemporary Electronics Mistakenly Relations Importance Characteristic Resistance Irresponsible Spreading Recognizable Adventures Integrates Partitioned Dimensional Reinstating Reactions Temporarily Exceptionally Experimental Respectively Biochemistry Grandmother Manipulated Uninteresting Unauthorized Directions Discretion Distinguished Discontinued Misleading Concentrating Subscription Sympathetic Complicated Cartridges Administration Deliberately Mathematicians Superficial Evolutionary Undertaking Historically Competitors Disadvantages Disclaimer Aesthetically Plastered Recreational Environments Discouraging Regulation Investigation Astronomers Restraining Advertises Appreciates Ingredients Measurements Discourage Disconnecting Qualifications Intervals Constraining Manifestation Signature Contributed Persuasion Precaution Responsible Compression Distinguishes Necessarily Momentarily Degradation Arrangements Implementation Similarities Participates Moderation Responding Sentimental Restarting Volunteering Separately Fluctuations Authorities Considering Backgrounds Restrictions Shortening Instructed Standardized Alternatively Exploration Transmitter Transferred Descriptive Discontinue Standardize Configuration Respecting Personally Resolution Advantageous Obstructing Operational Applications Unfortunately Alongside Incorporate Misplaced Communicated Compensate Classification Correspondence Educational Pharmacies Politeness Readership Advertised Interpretation Generators Specializing Circulates Counterpart Equivalents Investigates Originated Corresponded Enthusiasm Intersection Simulated Representing Ancestors Populations Distracted Journalists Reproducing Consistently Coordinate Arguments Acknowledged Prospective Tolerating Concentrated Consultation Intermediate Instruments Reinstates Appreciating Overwhelming Countries Universally Undergraduate Announcements Asserting Obstructed Correlation Psychologists Completeness Contradicts Disconnected Manufactured Abstraction Comfortable Theoretical Transactions Processing Appreciation Assembling Replacement Comparisons Profitable Psychologist Widespread Comparative Requirements Significantly Designates Capabilities Addressing Algorithms Categories Agreements Disadvantage Essentially Unreasonable Incorporating Purchasing Soundtrack Generalizes Sympathies Translations Understands Appropriately Specialist Fortunately Assertion Recordings Substantially Communications Contradicting Resulting Apostrophe Astronomer Skeptical Computational Downstairs Modifications Verification Establishes Constructing Contributions Universities Adjustments Bracketing Resemblance Permanently Cooperation Negotiations Experiments Guarantees Assumptions Distracting Eliminates Relatives Versatile Desirable Determines Supporting Understood Exceptional Industries Supervisions Purchased Secondary Destination Calculations Mainstream Outstanding Psychological Generalized Installed Differentiate Factories Directories Informative Advertise Assumption Complicating Encourages Materials Passionate Volunteers Assignments Exhausting Measurement Considered Constraints Acknowledge Celebrates Designated Integrated Relocation Reputation Spontaneous Appreciated Designating Explanatory Multiplication Requesting Frustration Stimulating Specialized Importantly Frustrating Practices Revelation Susceptible Fundamentally Presenting Searching Terminology Investigating Supervision Fascinated Geographical Identification Satisfactory Authorizes Organizations Measuring Extraneous Interrupts Moderately Procedures Reproduces Interacted Unsuitable Declaring Distributes Introduced Contributors Disappeared Operating Constructions Hypothetical Persistent Prematurely Sandwiches Scratching Assignment Progressing Computers Increased Contemplate Entertains Secretaries Releasing Shortened Documenting Sufficiently Implausible Recipients Compatible Translated Forecasts Negotiable Encountering Corresponds Concentration Constituents Journalist Restriction Scheduling Specialty Absolutely Indicators Prediction Productive Formulation Ownership Disconnects Anticipates Circulated Communities Fashionable Narrowest Reconsider Configured Estimating Exclamation Restaurants Department Potentially Recommending Supported Corrections Participated Deliberate Encounters Fragments Integration Rectangular Abbreviates Autobiography Supervising Accordingly Encouraged Investigate Combinations Incidentally Interrupted Understand Elevators Impressions Justifiable Approaches Favorites Comprised Elephants Philosophers Practicable Purchases Rhetorical Stimulation Stretching Transaction Sympathize Abbreviating Accompanies Brightness Positioned Strategies Wonderfully Differently Reasonably Anecdotes Parameters Proceeding Comparison Historical Suspecting Instrument Partitions Scratched Traveling Collections Discontinuing Alternative Introduce Reduction Consulted Disruption Simulating Guaranteeing Distances Exceptions Translation Preliminary Emphasizing Misplaces Pleasantly Realistic Reminiscent Volunteered Disappears Interacting Negotiates Participants Conventional Impression Permission Repeatedly Adjustment Attributes Charities Designate Inappropriate Supporters Afternoons Reassuring Standardizing Determining Establish Frustrated Simulates Previously Contradictory Fractions Functionality Reinstate Separated Unavoidable Undergoes Distributed Distribution Justification Replacing Drastically Traditionally Instructions Translating Discoveries Sequential Viewpoints Consumption Charitable Collaboration Eliminated Interaction Residents Transmissions Uncertainty Difficulties Duplication Emotionally Sustained Transparent Organizers Specifically Allocations Gravitational Inheritance Keyboards Noticeably Questioned Transmission Transmitting Considers Interested Unpleasant Identically Documents Interesting Performance Constitutes Constrains Contracted Supervised Synthesizer Preparation Candidates Idealistic Inspiration Resolving Scattered Regardless Centuries Companies Manipulate Presuming Constraint Consulting Intrinsically Manufacturing Marketing Underlines Suggestions Universal Continuations Controllers Correspond Deserving Foundations Afterwards Discovered Generation Improvement Operators Commissioned Complacent Complication Developers Estimation Pronunciation Speculate Displaying Reflection Abbreviation Consecutive Consisted Genetically Interruption Interviews Mathematically Misplacing Postulate Guaranteed Celebrated Construction Enlightens Essential Interprets Repeating Breathing Directives Headlines Publishers Strategic Substances Completing Encountered Commercially Installations Perfection Unimportant Distributing Irrelevant Restoring Commentator Inaccessible Resorting Increasing Compressed Disconnect Expressways Extraction Complicate Displayed Programmers Suggestion Architecture Experimented Expressions Grandfather Manufacturer Scenarios Consequently Possibilities Commentary Duplicated Experimenting Friendship Improbable Producers Tolerates Beforehand Differences Implements Industrial Translates Unnecessary Clarification Rebuilding Restrains Thoroughfare Authorized Comparable Reasonable Television Alphabetical Consolation Faculties Populates Provisional Questioning Resembling Alteration Approximate Exponential Inspection'.split(' ');

export const SOURCES: string[] = [...CURATED, ...MINED];

// ── Shuffle-bag selection ──────────────────────────────────────────────────
// Sources are dealt from a shuffled deck that persists across games and
// sessions: every source is used once before any repeats, and a new deck
// never starts with the previous deck's last few sources.
const DECK_KEY = 'lw.sourceDeck';
interface Deck { order: string[]; pos: number }

function shuffle<T>(a: T[]): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}
function loadDeck(): Deck | null {
  try {
    const d = JSON.parse(kv.get(DECK_KEY) || 'null') as Deck | null;
    // Rebuild if the source list changed since the deck was saved.
    if (!d || d.order.length !== SOURCES.length || d.order.some((s) => !SOURCES.includes(s))) return null;
    return d;
  } catch { return null; }
}
function saveDeck(d: Deck) {
  kv.set(DECK_KEY, JSON.stringify(d));
}
let memDeck: Deck | null = null;

function freshDeck(recent: string[]): Deck {
  let order = shuffle(SOURCES);
  // Keep recently played sources out of the first few slots of the new deck.
  const avoid = new Set(recent);
  const head = order.filter((s) => !avoid.has(s));
  const tail = order.filter((s) => avoid.has(s));
  order = [...head.slice(0, 8), ...shuffle([...head.slice(8), ...tail])];
  return { order, pos: 0 };
}

/** Next source from the deck, skipping any in `exclude` (e.g. used this match). */
export function nextSource(exclude: readonly string[] = []): string {
  let deck = memDeck ?? loadDeck() ?? freshDeck([]);
  for (let guard = 0; guard < SOURCES.length * 2; guard++) {
    if (deck.pos >= deck.order.length) deck = freshDeck(deck.order.slice(-6));
    const s = deck.order[deck.pos++];
    if (!exclude.includes(s)) {
      memDeck = deck;
      saveDeck(deck);
      return s;
    }
  }
  // Unreachable with 40 sources and ≤5 exclusions; fall back to any allowed source.
  return SOURCES.find((s) => !exclude.includes(s)) ?? SOURCES[0];
}

/** Pick `n` distinct sources at random, avoiding any in `exclude`. */
export function pickSources(n: number, exclude: readonly string[] = []): string[] {
  const pool = SOURCES.filter((s) => !exclude.includes(s));
  const base = pool.length >= n ? pool : SOURCES.slice();
  const out: string[] = [];
  const copy = base.slice();
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}
