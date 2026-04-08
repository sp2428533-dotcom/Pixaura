import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface MediaFile {
  id: string;
  file: File;
  type: 'image' | 'video';
  category: string;
  timestamp: number;
  isFavorite?: boolean;
  url?: string; // Object URL for display
  aiProcessed?: boolean;
  aiCaption?: string;
  aiHashtags?: string[];
  aiMood?: string;
  aiViralScore?: number;
  aiPostTime?: string;
}

interface PixauraDB extends DBSchema {
  media: {
    key: string;
    value: MediaFile;
    indexes: {
      'by-category': string;
      'by-timestamp': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<PixauraDB>> | null = null;

export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<PixauraDB>('pixaura-lite-db', 1, {
      upgrade(db) {
        const store = db.createObjectStore('media', { keyPath: 'id' });
        store.createIndex('by-category', 'category');
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
  }
  return dbPromise;
}

export async function saveMedia(media: Omit<MediaFile, 'url'>) {
  const db = await getDB();
  await db.put('media', media);
}

export async function updateMedia(media: Omit<MediaFile, 'url'>) {
  const db = await getDB();
  await db.put('media', media);
}

export async function getAllMedia(): Promise<MediaFile[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('media', 'by-timestamp');
  // Sort descending (newest first)
  return all.reverse();
}

export async function deleteMedia(id: string) {
  const db = await getDB();
  await db.delete('media', id);
}
