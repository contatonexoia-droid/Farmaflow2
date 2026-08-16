import React, { useEffect, useRef, useState } from 'react';
import { Order } from '../types';
import { BellRing, Check } from 'lucide-react';

interface OrderAlertProps {
  unacknowledgedOrders: Order[];
  onAcknowledge: () => void;
  primaryColor?: string;
  notificationSound?: string;
  notificationVolume?: number;
}

export const OrderAlert: React.FC<OrderAlertProps> = ({ unacknowledgedOrders, onAcknowledge, primaryColor = '#e11d48', notificationSound, notificationVolume = 0.5 }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Available sounds mapping to ensure fallback if not found
  const getSoundUrl = (soundId?: string) => {
    if (soundId?.startsWith('http')) return soundId;
    switch (soundId) {
        case 'digital': return 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg';
        case 'siren': return 'https://actions.google.com/sounds/v1/alarms/bugle_tune.ogg';
        case 'beep': return 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg';
        case 'classic': 
        default: return 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg';
    }
  };

  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    if (unacknowledgedOrders.length > 0) {
      if (!audioRef.current) {
        audioRef.current = new Audio(getSoundUrl(notificationSound));
        audioRef.current.loop = true;
      } else {
        // Change src if it was updated
        if (audioRef.current.src !== getSoundUrl(notificationSound)) {
            const wasPlaying = !audioRef.current.paused;
            audioRef.current.src = getSoundUrl(notificationSound);
            if (wasPlaying) {
                audioRef.current.play().catch(e => {
                  console.warn("Autoplay prep blocked", e);
                  setAutoplayBlocked(true);
                });
            }
        }
      }
      
      audioRef.current.volume = notificationVolume;
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        }).catch(err => {
          console.warn("Autoplay prevent - usuário precisa interagir com a tela antes de tocar som.", err);
          setAutoplayBlocked(true);
        });
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlaying(false);
        setAutoplayBlocked(false);
      }
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [unacknowledgedOrders.length]);

  if (unacknowledgedOrders.length === 0) return null;

  return (
    <>
      {autoplayBlocked && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-gray-900 text-white px-6 py-3 rounded-full text-sm font-bold shadow-2xl flex items-center gap-3 cursor-pointer hover:bg-gray-800 transition-colors" onClick={() => {
          if (audioRef.current) {
            audioRef.current.play().then(() => {
              setAutoplayBlocked(false);
              setIsPlaying(true);
            }).catch(console.error);
          }
        }}>
          <BellRing size={16} /> Ativar sons de notificação
        </div>
      )}
      <div className="fixed top-0 left-0 right-0 z-[9999] p-4 pointer-events-none flex justify-center animate-in slide-in-from-top-full duration-500">
      <div className="pointer-events-auto bg-white rounded-3xl shadow-2xl border-4 border-red-500 p-6 max-w-lg w-full flex items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-red-500 animate-pulse"></div>
        
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex flex-shrink-0 items-center justify-center animate-bounce">
          <BellRing size={32} />
        </div>
        
        <div className="flex-1">
          <h3 className="text-xl font-black text-gray-900 leading-tight mb-1">
            {unacknowledgedOrders.length} {unacknowledgedOrders.length === 1 ? 'Novo Pedido Recebido!' : 'Novos Pedidos Recebidos!'}
          </h3>
          <p className="text-sm font-bold text-gray-500 mb-4">
            Você tem {unacknowledgedOrders.length === 1 ? 'um pedido aguardando' : 'pedidos aguardando'} separação.
          </p>
          
          <button 
            onClick={onAcknowledge}
            className="w-full relative overflow-hidden group py-3 px-6 rounded-xl font-black text-white text-sm uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95"
            style={{ backgroundColor: primaryColor }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Check size={18} /> Visualizar e Silenciar
            </span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform"></div>
          </button>
        </div>
      </div>
    </div>
    </>
  );
};
