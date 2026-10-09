// Re-exporting durable persistence engine for all legacy and modern modules
import { durableDb, getKolkataDateKey } from './db/index';

export { durableDb as db, getKolkataDateKey };
