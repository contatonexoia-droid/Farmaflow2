import React, { useState, useEffect, useRef } from 'react';
import { Order, Product } from '../types';
import { X, CheckCircle, Package, AlertTriangle, ShieldAlert, Camera, CameraOff } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface OrderConferenceModalProps {
  order: Order;
  tenantPassword?: string;
  onClose: () => void;
  onConfirmDispatch: () => void;
  onDeductInstantly: (productId: string, qt: number) => Promise<{success: boolean, message?: string}>;
  onRevertInstantly: (scanned: Record<string, number>) => Promise<void>;
}

export const OrderConferenceModal: React.FC<OrderConferenceModalProps> = ({ 
  order, 
  tenantPassword, 
  onClose, 
  onConfirmDispatch,
  onDeductInstantly,
  onRevertInstantly
}) => {
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const [scanInput, setScanInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(isProcessing);
  const scannedItemsRef = useRef(scannedItems);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    scannedItemsRef.current = scannedItems;
  }, [scannedItems]);

  useEffect(() => {
    // Focar no input automaticamente (quando não estiver com câmera aberta e não estiver no modo de desvio manual)
    if (inputRef.current && !showCamera && !showManualOverride) {
      inputRef.current.focus();
    }
  }, [scanInput, showCamera, showManualOverride]);

  useEffect(() => {
    if (showCamera) {
      const initScanner = async () => {
        try {
          const html5QrCode = new Html5Qrcode("reader");
          scannerRef.current = html5QrCode;
          await html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 150 },
              aspectRatio: 1.0,
            },
            async (decodedText) => {
              if (isProcessingRef.current) return;
              
              // Pausar leitura até processar
              if (scannerRef.current) {
                // @ts-ignore - existe mas não tá na tipagem
                if(scannerRef.current.pause) scannerRef.current.pause(); 
              }

              setScanInput(decodedText);
              await processScannedCode(decodedText);
              
              // Retomar leitura
              if (scannerRef.current) {
                // @ts-ignore
                if(scannerRef.current.resume) scannerRef.current.resume();
              }
            },
            (errorMessage) => {
              // ignore parse errors silently
            }
          );
        } catch (err) {
          console.error("Error starting camera", err);
          setErrorMsg("Erro ao iniciar a câmera: Verifique as permissões de acesso.");
          setShowCamera(false);
        }
      };
      
      initScanner();

      return () => {
        const scanner = scannerRef.current;
        if (scanner) {
          scannerRef.current = null;
          try {
              if (scanner.getState && scanner.getState() === 2) {
                  scanner.stop().catch(err => console.error("Failed to stop scanner", err));
              } else if (scanner.isScanning) {
                  scanner.stop().catch(err => console.error("Failed to stop scanner", err));
              }
              scanner.clear();
          } catch(err) {
              console.error("Error during cleanup", err);
          }
        }
      };
    }
  }, [showCamera, order]); // added order just in case reference needs it, but order doesn't change usually

  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // Beep alto
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
      } else {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(200, audioCtx.currentTime); // Buzz grave
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
      }
    } catch(e) {
      console.warn("Audio API não suportada", e);
    }
  };

  const processScannedCode = async (code: string) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setErrorMsg('');

    const matchedItemInfo = order.items.find(item => 
      item.id.toLowerCase() === trimmedCode.toLowerCase() || 
      (item.barcode || '').toLowerCase() === trimmedCode.toLowerCase() ||
      (item.internalCode || '').toLowerCase() === trimmedCode.toLowerCase()
    );

    if (!matchedItemInfo) {
      playBeep('error');
      setErrorMsg('Produto não pertence ao pedido!');
      setScanInput('');
      return;
    }

    const currentScanned = scannedItemsRef.current[matchedItemInfo.id] || 0;
    if (currentScanned >= matchedItemInfo.quantity) {
      playBeep('error');
      setErrorMsg('Quantidade excedida para este produto!');
      setScanInput('');
      return;
    }

    setIsProcessing(true);
    isProcessingRef.current = true;
    try {
        const result = await onDeductInstantly(matchedItemInfo.id, 1);
        if (!result.success) {
            playBeep('error');
            setErrorMsg(result.message || 'Erro: Estoque insuficiente no sistema para baixa física.');
            setScanInput('');
            setIsProcessing(false);
            isProcessingRef.current = false;
            return;
        }

        // Success scan
        playBeep('success');
        setScannedItems(prev => ({
          ...prev,
          [matchedItemInfo.id]: currentScanned + 1
        }));
        setScanInput('');
    } catch (e) {
        playBeep('error');
        setErrorMsg('Erro na varredura - falha na conexão.');
    } finally {
        setIsProcessing(false);
        isProcessingRef.current = false;
    }
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    await processScannedCode(scanInput);
  };

  const isFullyScanned = () => {
    return order.items.every(item => (scannedItems[item.id] || 0) >= item.quantity);
  };

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantPassword && passwordInput === tenantPassword) {
      setIsProcessing(true);
      for (const item of order.items) {
        const scanned = scannedItems[item.id] || 0;
        const toDeduct = item.quantity - scanned;
        if (toDeduct > 0) {
          const result = await onDeductInstantly(item.id, toDeduct);
          if (!result.success) {
            setErrorMsg(result.message || 'Erro ao realizar baixa no override.');
            setIsProcessing(false);
            return;
          }
        }
      }
      setIsProcessing(false);
      onConfirmDispatch();
    } else {
      setErrorMsg('Senha incorreta!');
    }
  };

  const handleCancel = async () => {
      const totalScanned = Object.values(scannedItems).reduce((a,b)=>a+b,0);
      if (totalScanned > 0 && !isFullyScanned()) {
          setIsProcessing(true);
          await onRevertInstantly(scannedItems);
      }
      onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white w-full max-w-lg sm:max-w-3xl mx-auto max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
          <div>
            <h3 className="text-2xl font-black text-gray-900">Conferência de Pedido</h3>
            <p className="text-sm text-gray-500 font-bold mt-1">Pedido ID: {order.id}</p>
          </div>
          <button onClick={handleCancel} disabled={isProcessing} className="p-2 bg-white rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shadow-sm"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8 grid md:grid-cols-2 gap-8">
          
          {/* Left Column: Scanner */}
          <div className="space-y-6">
            <div className={`rounded-3xl p-6 border-2 transition-colors ${showCamera ? 'bg-gray-900 border-gray-800' : 'bg-emerald-50 border-emerald-100'}`}>
              <div className="flex items-center justify-between mb-4">
                <h4 className={`font-black text-lg ${showCamera ? 'text-white' : 'text-emerald-800'}`}>Bipar Produto</h4>
                <button 
                  onClick={() => setShowCamera(!showCamera)} 
                  className={`p-2 rounded-xl transition-colors ${showCamera ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-emerald-200 text-emerald-800 hover:bg-emerald-300'}`}
                >
                  {showCamera ? <CameraOff size={20} /> : <Camera size={20} />}
                </button>
              </div>

              {showCamera ? (
                <div className="rounded-2xl overflow-hidden bg-black aspect-video relative flex items-center justify-center">
                  <div id="reader" className="w-full h-full"></div>
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm z-10">
                      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleScanSubmit}>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Ler código EAN..."
                    className="w-full text-center text-xl font-bold bg-white px-6 py-4 rounded-2xl outline-none border-2 border-emerald-200 focus:border-emerald-500 shadow-inner"
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    onBlur={() => {
                      // Try to keep focus on scanner input so it's always ready
                      if (!showCamera && !showManualOverride) {
                        setTimeout(() => inputRef.current?.focus(), 100);
                      }
                    }}
                    autoFocus
                  />
                </form>
              )}

              {errorMsg && (
                <div className="bg-red-100 text-red-700 text-center text-sm font-bold mt-4 p-3 rounded-xl flex items-center justify-center gap-2 animate-shake">
                  <AlertTriangle size={18}/>
                  {errorMsg}
                </div>
              )}
            </div>

            <div className="bg-gray-50 rounded-3xl p-6 border-2 border-gray-100 text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mx-auto mb-4 text-gray-400">
                <CheckCircle size={32} className={isFullyScanned() ? "text-emerald-500" : ""} />
              </div>
              <p className="text-sm font-bold text-gray-500 mb-2">Progresso da Conferência</p>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(Object.values(scannedItems).reduce((a,b)=>a+b,0) / order.items.reduce((a,b)=>a+b.quantity,0)) * 100}%` }}
                ></div>
              </div>
              <p className="font-black text-xs text-emerald-600 uppercase">
                {Object.values(scannedItems).reduce((a,b)=>a+b,0)} de {order.items.reduce((a,b)=>a+b.quantity,0)} itens bipados
              </p>
            </div>
          </div>

          {/* Right Column: Check list */}
          <div className="space-y-4">
            <h4 className="font-black text-gray-900 border-b border-gray-100 pb-2">Itens para Conferir</h4>
            <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              {order.items.map(item => {
                const scanned = scannedItems[item.id] || 0;
                const isComplete = scanned >= item.quantity;
                return (
                  <div key={item.id} className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${isComplete ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${isComplete ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-300'}`}>
                      <CheckCircle size={20} />
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm line-clamp-2 ${isComplete ? 'text-emerald-900' : 'text-gray-800'}`}>{item.name}</p>
                      <p className="text-[10px] text-gray-400 font-bold mt-0.5">EAN/ID: {item.id}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black">
                        <span className={isComplete ? "text-emerald-600" : "text-gray-400"}>{scanned}</span>
                        <span className="text-gray-300 text-lg"> / {item.quantity}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-6 pb-8 sm:pb-6 border-t border-gray-100 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
          
          <div className="w-full sm:w-auto" onClick={(e) => e.stopPropagation()}>
            {!showManualOverride ? (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowManualOverride(true);
                  setTimeout(() => passwordInputRef.current?.focus(), 100);
                }}
                className="text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 flex items-center gap-2"
              >
                <ShieldAlert size={14}/> Pular conferência (Requer Senha)
              </button>
            ) : (
              <form 
                onSubmit={handleManualOverride} 
                className="flex items-center gap-2 w-full sm:w-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <input 
                  ref={passwordInputRef}
                  type="password" 
                  placeholder="Senha do Gerente" 
                  className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold outline-none"
                  value={passwordInput}
                  onChange={e => setPasswordInput(e.target.value)}
                  onClick={(e) => {
                    e.stopPropagation();
                    passwordInputRef.current?.focus();
                  }}
                  autoFocus
                />
                <button type="submit" className="px-4 py-2 bg-gray-800 text-white text-xs font-black rounded-xl hover:bg-gray-900" onClick={(e) => e.stopPropagation()}>Validar</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setShowManualOverride(false); }} className="px-2 py-2 text-gray-400 hover:text-red-500"><X size={16}/></button>
              </form>
            )}
          </div>

          <button 
            onClick={onConfirmDispatch}
            disabled={!isFullyScanned()}
            className={`w-full sm:w-auto px-8 py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl ${isFullyScanned() ? 'bg-emerald-500 hover:bg-emerald-600 justify-center flex text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed justify-center flex'}`}
          >
            {isFullyScanned() ? 'Despachar Pedido' : 'Conclua a Bipagem'}
          </button>
        </div>

      </div>
    </div>
  );
};
