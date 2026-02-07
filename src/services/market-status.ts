import { MarketStatus } from '../types/index';
import { getISTDate } from '../utils/helpers';

export function getIndianMarketStatus(): MarketStatus {
  const ist = getISTDate();
  const day = ist.getDay();
  const isWeekend = day === 0 || day === 6;

  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 15;   // 9:15 AM
  const marketClose = 15 * 60 + 30; // 3:30 PM

  const isOpen = !isWeekend && currentMinutes >= marketOpen && currentMinutes <= marketClose;

  let nextOpenDescription: string;
  if (isWeekend) {
    nextOpenDescription = 'Market closed (weekend). Opens Monday 9:15 AM IST.';
  } else if (currentMinutes < marketOpen) {
    nextOpenDescription = 'Pre-market. Opens at 9:15 AM IST.';
  } else if (currentMinutes > marketClose) {
    nextOpenDescription = 'Market closed. Last close prices shown.';
  } else {
    nextOpenDescription = 'Market is open.';
  }

  return { isOpen, isWeekend, nextOpenDescription };
}
