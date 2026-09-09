/**
 * Mock upstream data. Shapes are exactly as given in the assignment brief.
 * user_101 is the brief's example; the others exist so intent routing,
 * language/tone personalization and tier-based length can be demonstrated.
 */

export const USERS = {
  user_101: {
    id: 'user_101', name: 'Aarav Sharma', language: 'en',
    subscription: 'premium', tonePreference: 'motivational',
    birthDetails: { date: '1997-08-15', time: '09:35', place: 'Delhi' },
  },
  user_202: {
    id: 'user_202', name: 'Meera Iyer', language: 'hi',
    subscription: 'free', tonePreference: 'calm',
    birthDetails: { date: '1994-02-02', time: '21:10', place: 'Chennai' },
  },
};

export const KUNDLIS = {
  user_101: {
    lagna: 'Libra', moonSign: 'Scorpio',
    currentDasha: { mahadasha: 'Rahu', antardasha: 'Mars' },
    houses: {
      '6':  { lord: 'Jupiter', strength: 'Average' },
      '7':  { lord: 'Mars',    strength: 'Weak' },
      '10': { lord: 'Moon',    strength: 'Strong' },
    },
  },
  user_202: {
    lagna: 'Gemini', moonSign: 'Pisces',
    currentDasha: { mahadasha: 'Jupiter', antardasha: 'Saturn' },
    houses: {
      '6':  { lord: 'Mars',   strength: 'Strong' },
      '7':  { lord: 'Venus',  strength: 'Average' },
      '10': { lord: 'Saturn', strength: 'Weak' },
    },
  },
};

export const HOROSCOPES = {
  user_101: {
    career: 'Networking may bring new opportunities.',
    finance: 'Avoid risky investments.',
    health: 'Prioritize proper sleep.',
    relationship: 'Communication with your partner improves.',
  },
  user_202: {
    career: 'A steady phase; consolidate rather than switch.',
    finance: 'A long-pending payment may clear.',
    health: 'Watch your energy levels in the afternoon.',
    relationship: 'Family conversations go more smoothly than expected.',
  },
};

export function panchangFor(date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  // Deterministic rotation so the value is stable within a day and varies across days.
  const tithis = ['Shukla Panchami', 'Shukla Shashti', 'Krishna Dwitiya', 'Purnima'];
  const nakshatras = ['Rohini', 'Ashwini', 'Magha', 'Swati'];
  const yogas = ['Siddhi', 'Shubha', 'Vriddhi', 'Harshana'];
  const karanas = ['Bava', 'Balava', 'Kaulava', 'Taitila'];
  const seed = Number(iso.replaceAll('-', '')) % 4;
  return {
    date: iso,
    tithi: tithis[seed], nakshatra: nakshatras[seed],
    yoga: yogas[seed], karana: karanas[seed],
  };
}
