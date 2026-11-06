// Last word design tokens (blue theme), shared with the web prototype.
export const C = {
  bg: '#081428',
  bgMid: '#0D1E3D',
  bgTop: '#173A72',
  ink950: '#040A16',
  ink850: '#0C1A34',
  ink800: '#11223F',
  ink700: '#1A3260',
  /** Card and container surface: the primary blue, very faint. */
  card: 'rgba(61,139,255,0.1)',
  /** Light blue border used on every card and container. */
  cardBorder: 'rgba(61,139,255,0.35)',
  /** Dividers inside blue containers. */
  divider: 'rgba(61,139,255,0.2)',
  /** Disabled primary buttons: the primary blue at 50%. */
  primaryDisabled: 'rgba(61,139,255,0.5)',
  primary: '#3D8BFF',
  primaryTop: '#5C9EFF',
  primaryBottom: '#2F6FEB',
  mint: '#3EE6B8',
  amber: '#FFB547',
  coral: '#FF5D73',
  sky: '#5CC8FF',
  white: '#FFFFFF',
  tileTop: '#FFFFFF',
  tileBottom: '#FFFFFF',
  tileEdge: '#6F93C9',
  tileText: '#0B1A33',
  goldTop: '#FFF3DC',
  goldBottom: '#F6D9A0',
  goldEdge: '#C08A33',
  goldText: '#2A1A05',
};

/** White at a given opacity. */
export const w = (a: number) => `rgba(255,255,255,${a})`;

export const F = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  body: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
};
