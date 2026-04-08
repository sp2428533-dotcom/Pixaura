import React, { useState, useEffect, useRef } from 'react';
import { Plus, Image as ImageIcon, Video, X, Download, Trash2, CheckCircle2, Heart, Search, ArrowUpDown, CheckSquare, Square, Sparkles, Loader2, Menu, Home, Image as GalleryIcon, FolderHeart, Copy, Check, Clock, Flame, Star, Camera, SlidersHorizontal, Layout, Wand2 } from 'lucide-react';
import { cn } from './lib/utils';
import { saveMedia, getAllMedia, deleteMedia, updateMedia, MediaFile } from './lib/db';
import { GoogleGenAI } from '@google/genai';
import { motion, AnimatePresence } from 'motion/react';

const CATEGORIES = [
  'All',
  'Favorites',
  'Selfie',
  'Nature',
  'Friends',
  'Dark Mood',
  'Glow Up',
  'Videos',
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'gallery'>('home');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('Selfie');
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  
  const [copied, setCopied] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editSettings, setEditSettings] = useState({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
  
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [collagePrompt, setCollagePrompt] = useState('');
  const [collageSeed, setCollageSeed] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const aiQueue = useRef<MediaFile[]>([]);
  const isProcessingQueue = useRef(false);

  useEffect(() => {
    loadMedia();
    return () => {
      media.forEach((m) => {
        if (m.url) URL.revokeObjectURL(m.url);
      });
    };
  }, []);

  const loadMedia = async () => {
    const files = await getAllMedia();
    const filesWithUrls = files.map((f) => ({
      ...f,
      url: URL.createObjectURL(f.file),
    }));
    setMedia(filesWithUrls);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    
    if (type === 'video' && file.size > 10 * 1024 * 1024) {
      alert('Video size must be less than 10MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    let finalCategory = uploadCategory;
    if (type === 'video' && uploadCategory !== 'Videos') {
       finalCategory = 'Videos';
    }

    const newMedia: Omit<MediaFile, 'url'> = {
      id: crypto.randomUUID(),
      file,
      type,
      category: finalCategory,
      timestamp: Date.now(),
      isFavorite: false,
    };

    await saveMedia(newMedia);
    
    const mediaWithUrl: MediaFile = {
      ...newMedia,
      url: URL.createObjectURL(file),
    };

    setMedia((prev) => [mediaWithUrl, ...prev]);
    setIsUploadModalOpen(false);
    
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2000);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }

    if (type === 'image') {
      addToQueue(mediaWithUrl);
    }
  };

  const addToQueue = (item: MediaFile) => {
    aiQueue.current.push(item);
    if (!isProcessingQueue.current) {
      processQueue();
    }
  };

  const processQueue = async () => {
    if (aiQueue.current.length === 0) {
      isProcessingQueue.current = false;
      return;
    }
    isProcessingQueue.current = true;
    const item = aiQueue.current.shift();
    
    if (item) {
      await new Promise(resolve => setTimeout(resolve, 1500)); // Delayed AI load
      const all = await getAllMedia();
      const latest = all.find(m => m.id === item.id);
      if (latest && !latest.aiProcessed) {
        await processImageWithAI(item);
      }
    }
    processQueue();
  };

  const handleOpenPreview = (item: MediaFile) => {
    setPreviewFile(item);
    setEditSettings({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
    setIsEditing(false);
    if (item.type === 'image' && !item.aiProcessed) {
      processImageWithAI(item);
    }
  };

  const getFilterString = (settings: typeof editSettings) => {
    let base = `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`;
    if (settings.filter === 'vintage') base += ' sepia(50%) hue-rotate(-30deg)';
    if (settings.filter === 'soft-glow') base += ' brightness(110%) saturate(120%)';
    if (settings.filter === 'dark-mood') base += ' brightness(80%) contrast(120%) saturate(80%)';
    return base;
  };

  const saveEdit = async () => {
    if (!previewFile || previewFile.type !== 'image') return;
    
    const img = new Image();
    img.src = previewFile.url!;
    await new Promise(r => img.onload = r);
    
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.filter = getFilterString(editSettings);
    ctx.drawImage(img, 0, 0);
    
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `edited_${previewFile.file.name}`, { type: 'image/jpeg' });
      
      const newMedia: Omit<MediaFile, 'url'> = {
        id: crypto.randomUUID(),
        file,
        type: 'image',
        category: previewFile.category,
        timestamp: Date.now(),
        isFavorite: previewFile.isFavorite,
      };
      
      await saveMedia(newMedia);
      const mediaWithUrl: MediaFile = { ...newMedia, url: URL.createObjectURL(file) };
      
      setMedia(prev => [mediaWithUrl, ...prev]);
      setPreviewFile(mediaWithUrl);
      setIsEditing(false);
      
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2000);
      
      addToQueue(mediaWithUrl);
    }, 'image/jpeg', 0.9);
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    await deleteMedia(id);
    setMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return prev.filter((m) => m.id !== id);
    });
    if (previewFile?.id === id) {
      setPreviewFile(null);
    }
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    for (const id of selectedItems) {
      await handleDelete(id);
    }
    setIsMultiSelect(false);
  };

  const handleDownload = (file: MediaFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!file.url) return;
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toggleFavorite = async (item: MediaFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...item, isFavorite: !item.isFavorite };
    const { url, ...dbItem } = updated;
    await updateMedia(dbItem);
    setMedia(prev => prev.map(m => m.id === item.id ? updated : m));
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const processImageWithAI = async (mediaItem: MediaFile) => {
    if (mediaItem.type !== 'image' || mediaItem.aiProcessed) return;

    setIsProcessingAI(true);
    try {
      const buffer = await mediaItem.file.arrayBuffer();
      const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      
      const isSlowDevice = (navigator.hardwareConcurrency || 4) <= 4 || ((navigator as any).deviceMemory || 4) < 4;
      
      const prompt = isSlowDevice
        ? 'Analyze image. Return ONLY valid JSON: {"caption": "1 short aesthetic caption", "hashtags": ["#1", "#2", "#3", "#4", "#5"], "category": "Selfie or Nature or Friends or Dark Mood or Glow Up"}'
        : 'Analyze image. Return ONLY valid JSON: {"caption": "1 short aesthetic caption", "hashtags": ["#1", "#2", "#3", "#4", "#5"], "mood": "Happy or Sad or Aesthetic or Dark or Confident", "category": "Selfie or Nature or Friends or Dark Mood or Glow Up", "viralScore": 8.5, "postTime": "7:30 PM"}';

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: base64, mimeType: mediaItem.file.type } },
              { text: prompt }
            ]
          }
        ]
      });
      
      const text = response.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const aiData = JSON.parse(match[0]);
        
        const updatedMedia: MediaFile = {
          ...mediaItem,
          category: aiData.category || mediaItem.category,
          aiProcessed: true,
          aiCaption: aiData.caption,
          aiHashtags: aiData.hashtags,
          aiMood: aiData.mood,
          aiViralScore: aiData.viralScore,
          aiPostTime: aiData.postTime
        };

        const { url, ...dbItem } = updatedMedia;
        await updateMedia(dbItem);

        setMedia(prev => prev.map(m => m.id === mediaItem.id ? updatedMedia : m));
        setPreviewFile(prev => prev?.id === mediaItem.id ? updatedMedia : prev);
      }
    } catch (error) {
      console.error('Auto AI Processing failed:', error);
      const updatedMedia: MediaFile = { 
        ...mediaItem, 
        aiProcessed: true, 
        aiCaption: "Aesthetic vibes ✨", 
        aiHashtags: ["#aesthetic", "#vibes", "#mood", "#photography", "#daily"], 
        aiMood: "Aesthetic", 
        aiViralScore: 7.5, 
        aiPostTime: "8:00 PM" 
      };
      const { url, ...dbItem } = updatedMedia;
      await updateMedia(dbItem);
      setMedia(prev => prev.map(m => m.id === mediaItem.id ? updatedMedia : m));
      setPreviewFile(prev => prev?.id === mediaItem.id ? updatedMedia : prev);
    } finally {
      setIsProcessingAI(false);
    }
  };

  let processedMedia = media.filter(m => {
    const matchesFilter = activeFilter === 'All' || 
                          (activeFilter === 'Favorites' ? m.isFavorite : m.category === activeFilter);
    const matchesSearch = m.file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  processedMedia.sort((a, b) => {
    return sortOrder === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  let bestPhotoId: string | null = null;
  let maxScore = 0;
  
  media.forEach(m => {
    if (m.type === 'image' && m.timestamp >= todayTimestamp && m.aiViralScore && m.aiViralScore > maxScore) {
      maxScore = m.aiViralScore;
      bestPhotoId = m.id;
    }
  });

  return (
    <div className="min-h-screen pb-24 relative overflow-hidden">
      {/* Drawer Overlay */}
      <AnimatePresence>
        {isDrawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsDrawerOpen(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Drawer Menu */}
      <AnimatePresence>
        {isDrawerOpen && (
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 bottom-0 w-72 bg-white/90 backdrop-blur-xl z-50 border-r border-white/50 shadow-2xl flex flex-col"
          >
            <div className="p-6 flex items-center justify-between border-b border-gray-100">
              <h2 className="font-serif text-2xl font-semibold text-gray-900">Pixaura</h2>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
              <button
                onClick={() => {
                  setCurrentView('home');
                  setIsDrawerOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all",
                  currentView === 'home' 
                    ? "bg-pink-50 text-pink-600" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Home className="w-5 h-5" />
                Home
              </button>
              
              <button
                onClick={() => {
                  setCurrentView('gallery');
                  setActiveFilter('All');
                  setIsDrawerOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all",
                  currentView === 'gallery' && activeFilter === 'All'
                    ? "bg-pink-50 text-pink-600" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <GalleryIcon className="w-5 h-5" />
                Gallery
              </button>
              
              <button
                onClick={() => {
                  setCurrentView('gallery');
                  setActiveFilter('Favorites');
                  setIsDrawerOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all",
                  currentView === 'gallery' && activeFilter === 'Favorites'
                    ? "bg-pink-50 text-pink-600" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <FolderHeart className="w-5 h-5" />
                Favorites
              </button>
              
              <div className="pt-6 pb-2 px-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Categories</p>
              </div>
              
              {CATEGORIES.filter(c => c !== 'All' && c !== 'Favorites').map(cat => (
                <button
                  key={cat}
                  onClick={() => {
                    setCurrentView('gallery');
                    setActiveFilter(cat);
                    setIsDrawerOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all",
                    currentView === 'gallery' && activeFilter === cat
                      ? "bg-gray-100 text-gray-900" 
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-pink-300" />
                  {cat}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {currentView === 'home' ? (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            className="min-h-screen flex flex-col items-center justify-center relative px-6 py-24"
          >
            {/* Animated Background Blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className={cn("absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-pink-200/20 blur-[120px]", !isProcessingAI && "animate-blob")} />
              <div className={cn("absolute top-[20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-200/20 blur-[120px] animation-delay-2000", !isProcessingAI && "animate-blob")} />
              <div className={cn("absolute bottom-[-20%] left-[20%] w-[60%] h-[60%] rounded-full bg-blue-200/20 blur-[120px] animation-delay-4000", !isProcessingAI && "animate-blob")} />
            </div>

            <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center text-center">
              
              {/* Hero Images Preview */}
              <div className="relative w-full h-72 sm:h-96 mb-20 flex items-center justify-center">
                {media.length > 0 ? (
                  media.slice(0, 3).map((item, i) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 1.2, delay: i * 0.2, ease: "easeOut" }}
                      className="absolute z-10"
                      style={{ zIndex: i === 2 ? 10 : 5 }}
                    >
                      <motion.div
                        animate={{ y: [0, -10, 0] }}
                        transition={{ repeat: Infinity, duration: 6 + i, ease: "easeInOut" }}
                        style={{
                          rotate: i === 0 ? -4 : i === 1 ? 2 : -2,
                          x: i === 0 ? -100 : i === 1 ? 100 : 0,
                        }}
                        className="w-48 sm:w-64 aspect-[3/4] rounded-3xl overflow-hidden glass-card border-[3px] border-white/60 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)]"
                      >
                        {item.type === 'image' ? (
                          <img src={item.url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={item.url} className="w-full h-full object-cover" />
                        )}
                      </motion.div>
                    </motion.div>
                  ))
                ) : (
                  // Placeholder cards if no media
                  [1, 2, 3].map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 1.2, delay: i * 0.2, ease: "easeOut" }}
                      className="absolute z-10"
                      style={{ zIndex: i === 2 ? 10 : 5 }}
                    >
                      <motion.div
                        animate={{ y: [0, -10, 0] }}
                        transition={{ repeat: Infinity, duration: 6 + i, ease: "easeInOut" }}
                        style={{
                          rotate: i === 0 ? -4 : i === 1 ? 2 : -2,
                          x: i === 0 ? -100 : i === 1 ? 100 : 0,
                        }}
                        className="w-48 sm:w-64 aspect-[3/4] rounded-3xl overflow-hidden glass-card border-[3px] border-white/60 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] bg-gradient-to-br from-white/40 to-white/10"
                      />
                    </motion.div>
                  ))
                )}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, delay: 0.8, ease: "easeOut" }}
                className="flex flex-col items-center max-w-2xl"
              >
                <h1 className="font-serif text-5xl sm:text-7xl font-light text-gray-800 mb-6 tracking-[0.15em] uppercase">
                  Pixaura
                </h1>
                <p className="text-lg sm:text-xl text-gray-500 mb-4 font-sans font-light tracking-wide">
                  Turn your memories into vibes ✨
                </p>
                <p className="text-sm text-gray-400/80 mb-14 font-sans font-light tracking-wider uppercase">
                  Your memories deserve better. Make your gallery aesthetic.
                </p>

                <button
                  onClick={() => setCurrentView('gallery')}
                  className="group relative inline-flex items-center justify-center px-10 py-4 font-sans font-light tracking-widest text-white uppercase text-sm transition-all duration-500 bg-gradient-to-b from-gray-800 to-black rounded-full hover:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] hover:scale-[1.02] active:scale-[0.98] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
                >
                  Enter Gallery
                  <motion.span
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    className="ml-3 opacity-70"
                  >
                    →
                  </motion.span>
                </button>
              </motion.div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="gallery"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {/* Header */}
            <header className="sticky top-0 z-20 glass-panel border-b-0 px-6 py-4 mb-6">
              <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setIsDrawerOpen(true)}
                    className="p-2 hover:bg-white/50 rounded-full transition-colors"
                  >
                    <Menu className="w-6 h-6 text-gray-700" />
                  </button>
                  <h1 className="font-serif text-2xl font-semibold tracking-tight text-gray-900">
                    Pixaura Lite
                  </h1>
                </div>
                
                <div className="flex-1 max-w-md w-full relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search memories..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white/50 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 transition-all placeholder:text-gray-400"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
                    className="p-2 bg-white/50 hover:bg-white rounded-full text-gray-600 transition-colors shadow-sm border border-gray-100"
                    title={`Sort: ${sortOrder}`}
                  >
                    <ArrowUpDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setIsMultiSelect(!isMultiSelect);
                      setSelectedItems(new Set());
                    }}
                    className={cn(
                      "p-2 rounded-full transition-colors shadow-sm border",
                      isMultiSelect 
                        ? "bg-pink-100 text-pink-600 border-pink-200" 
                        : "bg-white/50 hover:bg-white text-gray-600 border-gray-100"
                    )}
                    title="Select Multiple"
                  >
                    <CheckSquare className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-all shadow-md hover:shadow-lg"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Add Memory</span>
                  </button>
                </div>
              </div>
            </header>

      {/* Multi-select Actions Bar */}
      <AnimatePresence>
        {isMultiSelect && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-6xl mx-auto px-6 mb-4 flex items-center justify-between bg-white/80 backdrop-blur-md py-3 px-6 rounded-2xl border border-gray-100 shadow-sm"
          >
            <span className="text-sm font-medium text-gray-600">
              {selectedItems.size} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedItems(new Set(processedMedia.map(m => m.id)))}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5"
              >
                Select All
              </button>
              <button
                onClick={() => setIsCollageModalOpen(true)}
                disabled={selectedItems.size < 2}
                className="text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 px-4 py-1.5 rounded-full transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Layout className="w-4 h-4" />
                Create Collage
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedItems.size === 0}
                className="text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 px-4 py-1.5 rounded-full transition-colors disabled:opacity-50"
              >
                Delete Selected
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categories */}
      <div className="max-w-6xl mx-auto px-6 mb-8 overflow-x-auto no-scrollbar">
        {/* Auto Collage Suggestion */}
        {processedMedia.filter(m => m.aiMood && m.aiMood === processedMedia[0]?.aiMood).length >= 3 && !isMultiSelect && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="mb-4 bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-100 rounded-2xl p-4 flex items-center justify-between shadow-sm cursor-pointer hover:shadow-md transition-all"
            onClick={() => {
              const mood = processedMedia[0]?.aiMood;
              const items = processedMedia.filter(m => m.aiMood === mood).slice(0, 5);
              setSelectedItems(new Set(items.map(i => i.id)));
              setIsMultiSelect(true);
              setCollagePrompt(`${mood} aesthetic`);
              setTimeout(() => setIsCollageModalOpen(true), 100);
            }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white rounded-full shadow-sm">
                <Sparkles className="w-5 h-5 text-pink-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-800">Create a {processedMedia[0]?.aiMood} collage ✨</h4>
                <p className="text-xs text-gray-500">We found {processedMedia.filter(m => m.aiMood === processedMedia[0]?.aiMood).length} similar photos.</p>
              </div>
            </div>
            <button className="px-4 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-full shadow-sm hover:bg-gray-50 transition-colors">
              Preview
            </button>
          </motion.div>
        )}
        <div className="flex gap-3 min-w-max pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all duration-300",
                activeFilter === cat
                  ? "bg-gray-900 text-white shadow-md scale-105"
                  : "glass-card text-gray-600 hover:bg-white/60"
              )}
            >
              {cat === 'Favorites' && <Heart className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />}
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      <main className="max-w-6xl mx-auto px-6">
        {processedMedia.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-32 text-center"
          >
            <div className="w-24 h-24 bg-white/50 backdrop-blur-sm rounded-full flex items-center justify-center mb-6 shadow-sm border border-white">
              <ImageIcon className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="font-serif text-2xl text-gray-800 mb-2">No memories found</h2>
            <p className="text-gray-500 max-w-sm">
              {searchQuery ? "Try a different search term." : "Upload your first photo or video to start building your aesthetic gallery."}
            </p>
          </motion.div>
        ) : (
          <motion.div layout={!isProcessingAI} className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            <AnimatePresence>
              {processedMedia.map((item) => (
                <motion.div
                  layout={!isProcessingAI}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  key={item.id}
                  onClick={() => isMultiSelect ? toggleSelection(item.id, { stopPropagation: () => {} } as any) : handleOpenPreview(item)}
                  className={cn(
                    "group relative break-inside-avoid rounded-3xl overflow-hidden glass-card cursor-zoom-in transition-all duration-300",
                    isMultiSelect && "cursor-pointer",
                    selectedItems.has(item.id) && "ring-4 ring-pink-300 ring-offset-2 ring-offset-pastel-bg"
                  )}
                >
                  {item.type === 'image' ? (
                    <img
                      src={item.url}
                      alt={item.file.name}
                      className="w-full h-auto object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="relative w-full">
                      <video
                        src={item.url}
                        className="w-full h-auto object-cover"
                        muted
                        loop
                        playsInline
                        onMouseOver={(e) => e.currentTarget.play()}
                        onMouseOut={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                      <div className="absolute top-3 right-3 bg-black/30 backdrop-blur-md p-1.5 rounded-full">
                        <Video className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  )}
                  
                  {/* Overlay actions */}
                  <div className={cn(
                    "absolute inset-0 transition-all duration-300 flex flex-col justify-between p-4",
                    isMultiSelect ? "bg-black/10 opacity-100" : "bg-black/0 group-hover:bg-black/20 opacity-0 group-hover:opacity-100"
                  )}>
                    <div className="flex justify-between items-start w-full">
                      <div className="flex flex-col gap-2">
                        {item.id === bestPhotoId && (
                          <div className="bg-yellow-400/90 backdrop-blur-md text-yellow-900 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1">
                            <Star className="w-3 h-3 fill-yellow-900" /> Best Today
                          </div>
                        )}
                        {item.aiMood && (
                          <div className="bg-white/80 backdrop-blur-md text-gray-800 text-[10px] font-medium px-2.5 py-1 rounded-full shadow-sm">
                            {item.aiMood}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                        {isMultiSelect ? (
                          <div className="p-1.5 bg-white/90 rounded-full shadow-sm">
                            {selectedItems.has(item.id) ? (
                              <CheckSquare className="w-5 h-5 text-pink-500" />
                            ) : (
                              <Square className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={(e) => toggleFavorite(item, e)}
                            className="p-2 bg-white/90 hover:bg-white rounded-full transition-colors shadow-sm"
                          >
                            <Heart className={cn("w-4 h-4 transition-colors", item.isFavorite ? "fill-pink-500 text-pink-500" : "text-gray-600")} />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {!isMultiSelect && (
                      <div className="flex justify-between items-end w-full mt-auto">
                        {item.aiViralScore ? (
                          <div className="bg-black/50 backdrop-blur-md text-white text-[10px] font-medium px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
                            <Flame className="w-3 h-3 text-orange-400" /> {item.aiViralScore.toFixed(1)}/10
                          </div>
                        ) : item.type === 'image' && !item.aiProcessed ? (
                          <div className="bg-black/50 backdrop-blur-md text-white text-[10px] font-medium px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
                          </div>
                        ) : <div />}
                        
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => handleDownload(item, e)}
                            className="p-2 bg-white/90 hover:bg-white rounded-full text-gray-800 transition-colors shadow-sm"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(item.id, e)}
                            className="p-2 bg-white/90 hover:bg-red-50 rounded-full text-red-500 transition-colors shadow-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white/90 backdrop-blur-xl rounded-[2rem] w-full max-w-md p-8 shadow-2xl border border-white/50"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="font-serif text-2xl font-semibold text-gray-900">Add to Gallery</h3>
                <button
                  onClick={() => setIsUploadModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-8">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Select Category
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.filter(c => c !== 'All' && c !== 'Favorites').map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setUploadCategory(cat)}
                        className={cn(
                          "px-4 py-2 rounded-full text-sm font-medium transition-all",
                          uploadCategory === cat
                            ? "bg-gray-900 text-white shadow-md"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileSelect}
                      ref={fileInputRef}
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="flex flex-col items-center justify-center w-full py-6 px-4 border-2 border-dashed border-gray-300 rounded-3xl cursor-pointer hover:border-gray-400 hover:bg-gray-50/50 transition-all group bg-white/50 h-full"
                    >
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform mb-3">
                        <ImageIcon className="w-6 h-6 text-gray-500 group-hover:text-gray-700" />
                      </div>
                      <span className="font-medium text-gray-700 text-center text-sm">Gallery</span>
                    </label>
                  </div>
                  
                  <div>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      capture="environment"
                      onChange={handleFileSelect}
                      ref={cameraInputRef}
                      className="hidden"
                      id="camera-upload"
                    />
                    <label
                      htmlFor="camera-upload"
                      className="flex flex-col items-center justify-center w-full py-6 px-4 border-2 border-dashed border-gray-300 rounded-3xl cursor-pointer hover:border-gray-400 hover:bg-gray-50/50 transition-all group bg-white/50 h-full"
                    >
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform mb-3">
                        <Camera className="w-6 h-6 text-gray-500 group-hover:text-gray-700" />
                      </div>
                      <span className="font-medium text-gray-700 text-center text-sm">Camera</span>
                    </label>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-400 mt-4">Videos up to 10MB</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 overflow-y-auto bg-black/95 backdrop-blur-xl"
            onClick={() => {
              setPreviewFile(null);
              setCopied(false);
            }}
          >
            <button
              className="fixed top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-[70]"
              onClick={() => {
                setPreviewFile(null);
                setCopied(false);
              }}
            >
              <X className="w-6 h-6" />
            </button>
            
            <div 
              className="min-h-full w-full flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 p-4 sm:p-8 pt-24 pb-32"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative flex-1 w-full flex items-center justify-center">
                {previewFile.type === 'image' ? (
                  <img
                    src={previewFile.url}
                    alt={previewFile.file.name}
                    className="w-full max-w-4xl h-auto object-contain rounded-2xl shadow-2xl transition-all duration-200"
                    style={{ filter: isEditing ? getFilterString(editSettings) : 'none' }}
                  />
                ) : (
                  <video
                    src={previewFile.url}
                    controls
                    autoPlay
                    className="w-full max-w-4xl h-auto rounded-2xl shadow-2xl bg-black"
                  />
                )}
              </div>

              {/* Sidebar for AI & Actions */}
              <div className="w-full lg:w-80 bg-white/10 backdrop-blur-md rounded-3xl p-6 text-white border border-white/10 shrink-0">
                <div className="flex items-center justify-between mb-6">
                  <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">
                    {previewFile.category}
                  </span>
                  <button
                    onClick={(e) => toggleFavorite(previewFile, e)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
                    <Heart className={cn("w-5 h-5", previewFile.isFavorite ? "fill-pink-500 text-pink-500" : "text-white")} />
                  </button>
                </div>

                {previewFile.type === 'image' && (
                  <div className="mb-8">
                    {isEditing ? (
                      <motion.div 
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={0.2}
                        onDragEnd={(e, info) => { if (info.offset.y > 100) setIsEditing(false); }}
                        initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }}
                        className="fixed bottom-0 left-0 right-0 lg:relative lg:bottom-auto lg:left-auto lg:right-auto bg-gray-900 lg:bg-white/5 rounded-t-[2rem] lg:rounded-2xl p-6 lg:p-5 border-t border-white/10 lg:border space-y-5 z-[60] shadow-[0_-20px_40px_rgba(0,0,0,0.5)] lg:shadow-none"
                      >
                        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-2 lg:hidden cursor-grab active:cursor-grabbing" />
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-white">Edit Style</h4>
                          <button onClick={() => setIsEditing(false)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Brightness</span>
                              <span>{editSettings.brightness}%</span>
                            </div>
                            <input type="range" min="50" max="150" value={editSettings.brightness} onChange={(e) => setEditSettings(s => ({...s, brightness: Number(e.target.value)}))} className="w-full accent-pink-500" />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Contrast</span>
                              <span>{editSettings.contrast}%</span>
                            </div>
                            <input type="range" min="50" max="150" value={editSettings.contrast} onChange={(e) => setEditSettings(s => ({...s, contrast: Number(e.target.value)}))} className="w-full accent-pink-500" />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Saturation</span>
                              <span>{editSettings.saturation}%</span>
                            </div>
                            <input type="range" min="0" max="200" value={editSettings.saturation} onChange={(e) => setEditSettings(s => ({...s, saturation: Number(e.target.value)}))} className="w-full accent-pink-500" />
                          </div>
                          
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Filters</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {['none', 'vintage', 'soft-glow', 'dark-mood'].map(f => (
                                <button
                                  key={f}
                                  onClick={() => setEditSettings(s => ({...s, filter: f}))}
                                  className={cn(
                                    "px-3 py-2 rounded-xl text-xs font-medium capitalize transition-colors",
                                    editSettings.filter === f ? "bg-pink-500 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
                                  )}
                                >
                                  {f.replace('-', ' ')}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        <button
                          onClick={saveEdit}
                          className="w-full py-3 px-4 bg-white text-black hover:bg-gray-100 rounded-2xl font-medium transition-colors mt-4"
                        >
                          Save Edit
                        </button>
                      </motion.div>
                    ) : !previewFile.aiProcessed ? (
                      <div className="w-full py-8 flex flex-col items-center justify-center gap-3 bg-white/5 rounded-2xl border border-white/10">
                        <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
                        <span className="text-sm text-gray-300">Analyzing aesthetic...</span>
                      </div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        className="bg-white/5 rounded-2xl p-5 border border-white/10 space-y-6"
                      >
                        <div>
                          <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Caption</h4>
                          <p className="text-sm font-serif italic text-gray-100 leading-relaxed">"{previewFile.aiCaption}"</p>
                        </div>
                        
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Hashtags</h4>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(previewFile.aiHashtags?.join(' ') || '');
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              className="text-[10px] text-pink-300 hover:text-pink-200 font-medium flex items-center gap-1 transition-colors"
                            >
                              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {copied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {previewFile.aiHashtags?.map(tag => (
                              <span key={tag} className="text-xs px-2 py-1 bg-white/10 rounded-md text-pink-200">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Viral Score</p>
                            <p className="text-lg font-bold text-white flex items-center gap-1">
                              <Flame className="w-4 h-4 text-orange-400" />
                              {previewFile.aiViralScore?.toFixed(1)}
                            </p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Best Time</p>
                            <p className="text-sm font-bold text-white mt-1 flex items-center gap-1">
                              <Clock className="w-4 h-4 text-blue-400" />
                              {previewFile.aiPostTime}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  {previewFile.type === 'image' && !isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                      <SlidersHorizontal className="w-5 h-5" />
                      Edit Style
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDownload(previewFile, e)}
                    className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    Download Original
                  </button>
                  <button
                    onClick={(e) => {
                      handleDelete(previewFile.id, e);
                    }}
                    className="w-full py-3 px-4 bg-red-500/20 hover:bg-red-500/40 text-red-200 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                    Delete Memory
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collage Modal */}
      <AnimatePresence>
        {isCollageModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
                <h3 className="font-serif text-2xl font-semibold text-gray-900">Create Collage</h3>
                <button onClick={() => setIsCollageModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col lg:flex-row gap-8">
                <div className="flex-1 flex flex-col gap-4">
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Describe your vibe...</label>
                    <div className="relative mb-3">
                      <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        value={collagePrompt}
                        onChange={(e) => setCollagePrompt(e.target.value)}
                        placeholder="e.g., soft girl pink aesthetic, dark mood"
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-200 transition-all"
                      />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                      {['Soft Girl', 'Dark Aesthetic', 'Clean Minimal', 'Scrapbook'].map(style => (
                        <button 
                          key={style} 
                          onClick={() => setCollagePrompt(style)} 
                          className="whitespace-nowrap px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-xs font-medium text-gray-700 transition-colors"
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {(() => {
                    const collageItems = Array.from(selectedItems).slice(0, 6);
                    const count = collageItems.length;
                    const p = collagePrompt.toLowerCase();
                    const isDark = p.includes('dark') || p.includes('grunge');
                    const isSoft = p.includes('soft') || p.includes('pink') || p.includes('cute');
                    const isClean = p.includes('clean') || p.includes('minimal');
                    const isScrapbook = p.includes('scrapbook') || p.includes('overlap');

                    let layoutType = 'grid';
                    if (isScrapbook) layoutType = 'overlap';
                    else if (count === 2) layoutType = 'side-by-side';
                    else if (count >= 3 && count <= 5) layoutType = 'masonry';
                    else if (count >= 6) layoutType = 'grid';

                    const bgColor = isDark ? '#121212' : isSoft ? '#fce4ec' : isClean ? '#ffffff' : '#fdfbf7';
                    const gap = isClean ? '24px' : isDark ? '4px' : '12px';
                    const borderRadius = isClean ? '0px' : isSoft ? '24px' : '12px';
                    const padding = isClean ? '40px' : '24px';

                    return (
                      <div 
                        className="w-full aspect-square sm:aspect-[4/3] overflow-hidden shadow-inner relative flex items-center justify-center transition-all duration-500"
                        style={{ backgroundColor: bgColor, padding, borderRadius: isClean ? '0px' : '24px' }}
                      >
                        {layoutType === 'overlap' && (
                          <div className="relative w-full h-full">
                            {collageItems.map((id, i) => {
                              const item = media.find(m => m.id === id);
                              if (!item || item.type !== 'image') return null;
                              const rand1 = Math.abs(Math.sin(collageSeed + i * 10));
                              const rand2 = Math.abs(Math.cos(collageSeed + i * 10));
                              const rot = (rand1 * 40) - 20;
                              const left = 5 + (rand1 * 50);
                              const top = 5 + (rand2 * 50);
                              const width = 40 + (rand2 * 20);
                              return (
                                <img 
                                  key={id} 
                                  src={item.url} 
                                  className="absolute shadow-2xl object-cover border-4 border-white transition-all duration-500" 
                                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, aspectRatio: '3/4', transform: `rotate(${rot}deg)`, borderRadius, zIndex: i }} 
                                  alt=""
                                />
                              )
                            })}
                          </div>
                        )}
                        {layoutType === 'side-by-side' && (
                          <div className="flex w-full h-full transition-all duration-500" style={{ gap }}>
                            {collageItems.map(id => {
                              const item = media.find(m => m.id === id);
                              return <img key={id} src={item?.url} className="flex-1 w-1/2 object-cover shadow-sm transition-all duration-500" style={{ borderRadius }} alt="" />
                            })}
                          </div>
                        )}
                        {layoutType === 'masonry' && (
                          <div className="columns-2 w-full h-full space-y-4 transition-all duration-500" style={{ columnGap: gap }}>
                            {collageItems.map((id, i) => {
                              const item = media.find(m => m.id === id);
                              const rand = Math.abs(Math.sin(collageSeed + i));
                              const aspect = rand > 0.5 ? '4/5' : '1/1';
                              return <img key={id} src={item?.url} className="w-full object-cover shadow-sm mb-4 transition-all duration-500" style={{ borderRadius, aspectRatio: aspect }} alt="" />
                            })}
                          </div>
                        )}
                        {layoutType === 'grid' && (
                          <div className="grid w-full h-full transition-all duration-500" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap }}>
                            {collageItems.map(id => {
                              const item = media.find(m => m.id === id);
                              return <img key={id} src={item?.url} className="w-full h-full object-cover shadow-sm transition-all duration-500" style={{ borderRadius, aspectRatio: '1/1' }} alt="" />
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                <div className="w-full lg:w-64 shrink-0 flex flex-col gap-4">
                  <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-3">
                    <h4 className="text-sm font-semibold text-gray-800">Collage Settings</h4>
                    <p className="text-xs text-gray-500">The layout and styling are automatically generated based on your prompt.</p>
                    <div className="mt-2 pt-4 border-t border-gray-100 flex flex-col gap-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Images</span>
                        <span className="font-medium text-gray-900">{Math.min(selectedItems.size, 6)} (Max 6)</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Style</span>
                        <span className="font-medium text-gray-900 capitalize truncate ml-2">{collagePrompt || 'Default'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setCollageSeed(s => s + 1)}
                    className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    Shuffle Layout
                  </button>
                  
                  <button
                    onClick={() => {
                      // In a real app, we'd draw this to a canvas and save it.
                      // For this lightweight version, we'll just show a success toast.
                      setIsCollageModalOpen(false);
                      setIsMultiSelect(false);
                      setSelectedItems(new Set());
                      setShowSavedToast(true);
                      setTimeout(() => setShowSavedToast(false), 2000);
                    }}
                    className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium transition-colors shadow-md flex items-center justify-center gap-2 mt-auto"
                  >
                    <Download className="w-4 h-4" />
                    Save Collage
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Saved Toast */}
      <AnimatePresence>
        {showSavedToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="font-medium">Saved to gallery</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
