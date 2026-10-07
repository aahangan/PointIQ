// Subscription tiers and feature gating. The app calls can(feature) everywhere; billing
// (Stripe) only has to set the account's plan key. Prices are the launch hypothesis, to be
// tested with real programs.

export const PLANS = [
  {
    key: 'starter', name: 'Starter', monthly: 0, season: 0, annual: 0,
    who: 'Any coach trying PointIQ',
    blurb: 'Rotation win probability from your own numbers.',
    limits: { teams: 1, lineups: 1, imports: 3 },
    features: ['rotation-input', 'set-prob', 'match-prob', 'csv-rotation'],
  },
  {
    key: 'coach', name: 'Coach', monthly: 29, season: 99, annual: 249,
    who: 'High school and club teams',
    blurb: 'Every lineup decision, modeled before the whistle.',
    limits: { teams: 1, lineups: 50, imports: Infinity },
    features: ['rotation-input', 'set-prob', 'match-prob', 'csv-rotation', 'lineup-lab', 'libero-subs', 'start-optimizer', 'live-tracker', 'import-boxscore', 'import-dvw', 'opponent-report'],
  },
  {
    key: 'program', name: 'Program', monthly: 79, season: 299, annual: 749,
    who: 'College programs and multi-team clubs',
    blurb: 'Multi-season modeling and full lineup search for a whole staff.',
    limits: { teams: 12, lineups: Infinity, imports: Infinity, seats: 6 },
    features: ['rotation-input', 'set-prob', 'match-prob', 'csv-rotation', 'lineup-lab', 'libero-subs', 'start-optimizer', 'live-tracker', 'import-boxscore', 'import-dvw', 'opponent-report', 'hierarchical', 'order-search', 'game-theory', 'multi-team', 'data-export', 'model-lab'],
  },
  {
    key: 'recruit', name: 'Program + Recruiting', monthly: 149, season: 549, annual: 1490,
    who: 'D1 / D2 / D3 recruiting staffs',
    blurb: 'Level-adjusted prospect ratings with honest uncertainty.',
    limits: { teams: 12, lineups: Infinity, imports: Infinity, seats: 10, prospects: Infinity },
    features: ['rotation-input', 'set-prob', 'match-prob', 'csv-rotation', 'lineup-lab', 'libero-subs', 'start-optimizer', 'live-tracker', 'import-boxscore', 'import-dvw', 'opponent-report', 'hierarchical', 'order-search', 'game-theory', 'multi-team', 'data-export', 'model-lab', 'recruiting'],
  },
];

export const FEATURE_LABEL = {
  'rotation-input': 'Rotation side-out / point-score entry',
  'set-prob': 'Set win probability',
  'match-prob': 'Best-of-3 / best-of-5 match probability',
  'csv-rotation': 'Rotation CSV import',
  'lineup-lab': 'Lineup Lab (player-level model)',
  'libero-subs': 'Libero, serving subs and DS swaps',
  'start-optimizer': 'Starting-rotation optimizer',
  'live-tracker': 'Live match tracker with win probability',
  'import-boxscore': 'SoloStats / Hudl / MaxPreps box-score import',
  'import-dvw': 'DataVolley .dvw import (Hudl VolleyMetrics)',
  'opponent-report': 'Opponent rotation report from .dvw',
  hierarchical: 'Multi-season hierarchical model',
  'order-search': 'Serving-order search',
  'game-theory': 'Start-rotation game theory (mixed strategy)',
  'multi-team': 'Multiple teams (JV, club age groups)',
  'data-export': 'Full data export',
  'model-lab': 'Predictive model lab (rally-learned rates, calibration)',
  recruiting: 'Recruiting board and prospect ratings',
};

export const planByKey = (k) => PLANS.find((p) => p.key === k) || PLANS[0];
export const can = (planKey, feature) => planByKey(planKey).features.includes(feature);
export const minPlanFor = (feature) => PLANS.find((p) => p.features.includes(feature));
