import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export const NetworkStatusBadge: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div
      id="header-network-status-indicator"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors shrink-0 ${
        isOnline
          ? 'bg-emerald-950/70 text-emerald-400 border-emerald-800/40'
          : 'bg-amber-950/80 text-amber-300 border-amber-800/60 animate-pulse'
      }`}
      title={isOnline ? 'Network Connected (Online)' : 'Working Offline (Cached Mode)'}
      aria-label={isOnline ? 'Online' : 'Offline / Cached'}
    >
      {isOnline ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span className="hidden md:inline">Online</span>
        </>
      ) : (
        <>
          <WifiOff className="w-2.5 h-2.5 text-amber-400" />
          <span className="hidden md:inline">Cached</span>
        </>
      )}
    </div>
  );
};
