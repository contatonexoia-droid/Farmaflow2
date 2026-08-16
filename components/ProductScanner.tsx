import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Keyboard, AlertTriangle, ScanLine } from 'lucide-react';

interface ProductScannerProps {
    onScan: (decodedText: string) => void;
    onClose: () => void;
}

const ProductScanner: React.FC<ProductScannerProps> = ({ onScan, onClose }) => {
    const [mode, setMode] = useState<'keyboard' | 'camera'>('keyboard');
    const [barcodeInput, setBarcodeInput] = useState('');
    const [error, setError] = useState<string>('');
    const [isSecure, setIsSecure] = useState(true);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input automatically in keyboard mode
    useEffect(() => {
        if (mode === 'keyboard') {
            const timeoutId = setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
            return () => clearTimeout(timeoutId);
        }
    }, [mode]);

    // Check secure context
    useEffect(() => {
        if (window.isSecureContext === false) {
            setIsSecure(false);
        }
    }, []);

    const startCamera = async () => {
        setError('');
        
        // Permission check
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const permission = await navigator.permissions.query({ name: 'camera' as any });
                if (permission.state === 'denied') {
                    setError('Permissão de câmera negada. Verifique as configurações do navegador e tente novamente.');
                    return;
                }
            }
        } catch (e) {
            // Some browsers don't support camera permission query
            console.log("Permission query not supported");
        }

        try {
            const scanner = new Html5Qrcode("reader");
            scannerRef.current = scanner;

            const config = { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };
            
            await scanner.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    // Just call onScan. The parent component will typically close the modal,
                    // triggering the useEffect cleanup which handles stopping the camera safely.
                    onScan(decodedText);
                },
                (errorMessage) => {
                    // Ignore frame errors
                }
            );
        } catch (err: any) {
            console.error("Camera error:", err);
            setError("Não foi possível acessar a câmera. Verifique as permissões ou se há outra aba usando a câmera.");
        }
    };

    const stopCamera = async () => {
        const scanner = scannerRef.current;
        if (scanner) {
            // Clear ref immediately to prevent subsequent calls
            scannerRef.current = null;
            try {
                if (scanner.getState && scanner.getState() === 2) { // 2 = SCANNING
                    await scanner.stop();
                } else if (scanner.isScanning) {
                    await scanner.stop();
                }
                scanner.clear();
            } catch (err) {
                console.error("Failed to stop camera", err);
            }
        }
    };

    useEffect(() => {
        if (mode === 'camera') {
            startCamera();
        } else {
            stopCamera();
        }

        return () => {
            stopCamera();
        };
    }, [mode]);

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (barcodeInput.trim()) {
                onScan(barcodeInput.trim());
                setBarcodeInput('');
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <button 
                onClick={onClose}
                className="absolute top-6 right-6 p-4 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all backdrop-blur-md"
            >
                <X size={24} />
            </button>
            <div className="w-full max-w-md bg-white rounded-[2rem] overflow-hidden shadow-2xl">
                <div className="p-6 text-center border-b border-gray-100 bg-gray-50">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <ScanLine size={32} />
                    </div>
                    <h2 className="text-gray-900 text-xl font-black mb-1">Entrada de Produto</h2>
                    <p className="text-gray-500 text-sm font-medium">Escolha como deseja ler o código de barras do produto.</p>
                </div>
                
                <div className="p-6 space-y-6">
                    {/* Mode Selector */}
                    <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                        <button
                            onClick={() => setMode('keyboard')}
                            className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-bold text-[13px] sm:text-sm transition-all ${
                                mode === 'keyboard' 
                                    ? 'bg-white text-gray-900 shadow-sm' 
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <Keyboard size={18} />
                            Leitor USB / Digitar
                        </button>
                        <button
                            onClick={() => setMode('camera')}
                            className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-bold text-[13px] sm:text-sm transition-all ${
                                mode === 'camera' 
                                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' 
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <Camera size={18} />
                            Usar Câmera
                        </button>
                    </div>

                    {mode === 'keyboard' && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center">
                                <p className="text-sm font-bold text-blue-900">
                                    Pronto para ler!
                                </p>
                                <p className="text-xs font-medium text-blue-700 mt-1">
                                    Use o leitor físico ou digite o código de barras e aperte Enter.
                                </p>
                            </div>
                            <div className="relative">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={barcodeInput}
                                    onChange={(e) => setBarcodeInput(e.target.value)}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder="Ex: 7891010101010"
                                    className="w-full bg-gray-50 border-2 border-gray-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 rounded-2xl px-4 py-4 text-center text-xl font-bold text-gray-900 tracking-widest transition-all outline-none"
                                    autoFocus
                                />
                            </div>
                            <button 
                                onClick={() => {
                                    if (barcodeInput.trim()) {
                                        onScan(barcodeInput.trim());
                                        setBarcodeInput('');
                                    }
                                }}
                                disabled={!barcodeInput.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl shadow-md transition-all active:scale-[0.98]"
                            >
                                Buscar Produto
                            </button>
                        </div>
                    )}

                    {mode === 'camera' && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            {!isSecure && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs font-bold flex items-start gap-3">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                                    <div>
                                        Conexão não segura detectada. Navegadores exigem protocolo HTTPS para liberar o acesso à câmera.
                                    </div>
                                </div>
                            )}

                            {error ? (
                                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm font-bold text-center">
                                    {error}
                                </div>
                            ) : (
                                <div className="bg-black rounded-2xl overflow-hidden relative shadow-inner aspect-square flex items-center justify-center">
                                    <div id="reader" className="w-full h-full object-cover"></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductScanner;
