import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Terminal, Download, Trash2, Play, Highlighter, Send,
  Zap, Activity, Command, Copy, Plus, X,
  Pause, Edit2, Save, Plug, Search, Usb, Filter,
  ChevronDown, Check, ShieldCheck, List, Monitor,
  ChevronRight, Timer, Clock
} from 'lucide-react';

// --- Utility: CRC16 Modbus Calculation ---
const calculateCRC16 = (buffer) => {
  let crc = 0xFFFF;
  for (let pos = 0; pos < buffer.length; pos++) {
    crc ^= buffer[pos];
    for (let i = 8; i !== 0; i--) {
      if ((crc & 0x0001) !== 0) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return new Uint8Array([crc & 0xFF, (crc >> 8) & 0xFF]);
};

// --- Utility: HEX String Parsing ---
const parseHexString = (str) => {
  const cleanStr = str.replace(/[^0-9a-fA-F]/g, '');
  if (!cleanStr || cleanStr.length % 2 !== 0) return null;
  const byteArray = new Uint8Array(cleanStr.length / 2);
  for (let i = 0; i < cleanStr.length; i += 2) {
    byteArray[i / 2] = parseInt(cleanStr.substring(i, i + 2), 16);
  }
  return byteArray;
};

const bufferToHex = (buffer) => {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
};

export default function App() {
  // --- States ---
  const [port, setPort] = useState(null);
  const portRef = useRef(null);
  const [availablePorts, setAvailablePorts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const readerRef = useRef(null);
  const closingRef = useRef(false);
  const baudRef = useRef(null);

  // Buffering Logic
  const rxBufferRef = useRef('');
  const rxTimeoutRef = useRef(null);
  const logContainerRef = useRef(null);

  // Interaction States
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isBaudDropdownOpen, setIsBaudDropdownOpen] = useState(false);
  const [portSearchQuery, setPortSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  // Log Management
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewMode, setViewMode] = useState('ascii');
  const [logFilter, setLogFilter] = useState('');

  // Persisted Config
  const usePersistedState = (key, defaultValue) => {
    const [state, setState] = useState(() => {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch { return defaultValue; }
    });
    useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
    return [state, setState];
  };

  const [baudRate, setBaudRate] = usePersistedState('sf_baud', 115200);
  const [encoding, setEncoding] = usePersistedState('sf_enc', 'utf-8');
  const [highlightKeyword, setHighlightKeyword] = usePersistedState('sf_hl_kw', '');
  const [highlightColor, setHighlightColor] = usePersistedState('sf_hl_col', 'text-amber-400 bg-amber-400/25 border-amber-400/50');
  const [quickCommands, setQuickCommands] = usePersistedState('sf_cmds', [
    { id: 1, label: 'Status', cmd: 'AT+STATUS?' },
    { id: 2, label: 'Reset', cmd: 'AT+RST' },
    { id: 3, label: 'Info', cmd: 'AT+GMR' },
  ]);
  const [useHexSend, setUseHexSend] = usePersistedState('sf_hex_send', false);
  const [lineEnding, setLineEnding] = usePersistedState('sf_eol', '\\n');
  const [appendCRC, setAppendCRC] = usePersistedState('sf_crc', false);
  const [showTimestamp, setShowTimestamp] = usePersistedState('sf_show_ts', true);

  // Timer Send
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerInterval, setTimerInterval] = usePersistedState('sf_timer_ms', 1000);
  const timerRef = useRef(null);
  const inputTextRef = useRef(''); // 用于定时发送

  const [inputText, setInputText] = useState('');
  const [sendHistory, setSendHistory] = usePersistedState('sf_history', []);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isEditingCmds, setIsEditingCmds] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [lastActivity, setLastActivity] = useState({ type: null, time: 0 });

  const isWebSerialSupported = 'serial' in navigator;

  // --- Logic ---
  useEffect(() => { portRef.current = port; }, [port]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

  const updatePorts = useCallback(async () => {
    if (!isWebSerialSupported) return;
    try { setAvailablePorts(await navigator.serial.getPorts()); } catch { /* ignore */ }
  }, [isWebSerialSupported]);

  const disconnectPort = useCallback(async () => {
    closingRef.current = true;
    setTimerEnabled(false); // Stop timer on disconnect
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (readerRef.current) await readerRef.current.cancel();
      const currentPort = portRef.current;
      if (currentPort) await currentPort.close();
    } catch (e) { console.error(e); }
    setPort(null);
    portRef.current = null;
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!isWebSerialSupported) return;

    const handleConnect = () => { updatePorts(); };
    const handleDisconnect = (e) => {
      updatePorts();
      if (portRef.current === e.target) disconnectPort();
    };

    updatePorts();
    navigator.serial.addEventListener('connect', handleConnect);
    navigator.serial.addEventListener('disconnect', handleDisconnect);

    return () => {
      navigator.serial.removeEventListener('connect', handleConnect);
      navigator.serial.removeEventListener('disconnect', handleDisconnect);
    };
  }, [isWebSerialSupported, updatePorts, disconnectPort]);

  const openPort = async (selectedPort) => {
    try {
      await selectedPort.open({ baudRate: parseInt(baudRate) || 115200 });
      setPort(selectedPort);
      portRef.current = selectedPort;
      setIsConnected(true);
      setIsConnectModalOpen(false);
      closingRef.current = false;
      readLoop(selectedPort);
    } catch (error) {
      alert(`Connection failed: ${error.message}`);
    }
  };

  const getTimestamp = useCallback(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
  }, []);

  // 用于定时发送的直接发送函数（不清空输入）
  const sendDataDirect = useCallback(async (text) => {
    if (!port?.writable || !text) return;
    const writer = port.writable.getWriter();
    try {
      let data;
      let display;
      if (useHexSend) {
        const bytes = parseHexString(text);
        if (!bytes) { writer.releaseLock(); return; }
        data = bytes;
        display = bufferToHex(bytes);
      } else {
        let str = text;
        if (lineEnding === '\\n') str += '\n';
        else if (lineEnding === '\\r\\n') str += '\r\n';
        data = new TextEncoder().encode(str);
        display = str.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      }
      if (appendCRC) {
        const crc = calculateCRC16(data);
        const merged = new Uint8Array(data.length + 2);
        merged.set(data);
        merged.set(crc, data.length);
        data = merged;
        display += ` [CRC16]`;
      }
      await writer.write(data);
      setLastActivity({ type: 'tx', time: Date.now() });
      setLogs(prev => [...prev, { id: Math.random(), timestamp: getTimestamp(), text: display, type: 'tx' }].slice(-1500));
    } catch (e) {
      console.error(e);
    } finally {
      writer.releaseLock();
    }
  }, [appendCRC, getTimestamp, lineEnding, port, useHexSend]);

  const flushBuffer = () => {
    if (rxBufferRef.current.length > 0) {
      const timestamp = getTimestamp();
      const content = rxBufferRef.current;
      setLogs(prev => [...prev, { id: Math.random(), timestamp, text: content, type: 'rx' }].slice(-1500));
      rxBufferRef.current = '';
    }
  };

  const readLoop = async (p) => {
    const decoder = new TextDecoder(encoding);
    readerRef.current = p.readable.getReader();
    try {
      while (true) {
        const { value, done } = await readerRef.current.read();
        if (done) break;
        if (value && !isPausedRef.current) {
          setLastActivity({ type: 'rx', time: Date.now() });

          if (viewMode === 'hex') {
            const hexContent = bufferToHex(value);
            const timestamp = getTimestamp();
            setLogs(prev => [...prev, { id: Math.random(), timestamp, text: hexContent, type: 'rx' }].slice(-1500));
          } else {
            const decoded = decoder.decode(value, { stream: true });
            rxBufferRef.current += decoded;

            if (rxTimeoutRef.current) clearTimeout(rxTimeoutRef.current);

            // 立即处理：如果有换行就分行显示，否则直接显示当前buffer
            if (rxBufferRef.current.includes('\n')) {
              const lines = rxBufferRef.current.split('\n');
              rxBufferRef.current = lines.pop(); // 保留最后不完整的部分
              const timestamp = getTimestamp();
              const newEntries = lines.map(line => ({
                id: Math.random(), timestamp, text: line.replace('\r', ''), type: 'rx'
              }));
              if (newEntries.length > 0) {
                setLogs(prev => [...prev, ...newEntries].slice(-1500));
              }
            }
            // 缩短超时到10ms，更快flush残留数据
            rxTimeoutRef.current = setTimeout(flushBuffer, 10);
          }
        }
      }
    } catch (e) {
      if (!closingRef.current) console.error(e);
    } finally {
      if (readerRef.current) {
        try { readerRef.current.releaseLock(); } catch { /* ignore */ }
      }
    }
  };

  // Timer Send Effect
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (timerEnabled && isConnected) {
      timerRef.current = setInterval(() => {
        if (inputTextRef.current) {
          sendDataDirect(inputTextRef.current);
        }
      }, timerInterval);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timerEnabled, isConnected, timerInterval, sendDataDirect]);

  const sendData = async (textOverride = null) => {
    const text = textOverride !== null ? textOverride : inputText;
    if (!port?.writable || !text) return;

    const writer = port.writable.getWriter();
    try {
      let data;
      let display;

      if (useHexSend) {
        const bytes = parseHexString(text);
        if (!bytes) throw new Error("Invalid HEX String");
        data = bytes;
        display = bufferToHex(bytes);
      } else {
        let str = text;
        if (lineEnding === '\\n') str += '\n';
        else if (lineEnding === '\\r\\n') str += '\r\n';
        data = new TextEncoder().encode(str);
        display = str.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      }

      if (appendCRC) {
        const crc = calculateCRC16(data);
        const merged = new Uint8Array(data.length + 2);
        merged.set(data);
        merged.set(crc, data.length);
        data = merged;
        display += ` [CRC16]`;
      }

      await writer.write(data);
      setLastActivity({ type: 'tx', time: Date.now() });
      setLogs(prev => [...prev, {
        id: Math.random(),
        timestamp: getTimestamp(),
        text: display,
        type: 'tx'
      }].slice(-1500));

      if (textOverride === null) {
        setSendHistory(prev => {
          const filtered = prev.filter(h => h !== text);
          return [text, ...filtered].slice(0, 50);
        });
        setHistoryIndex(-1);
        setInputText('');
      }
    } catch (e) {
      alert(`Send failed: ${e.message}`);
    } finally {
      writer.releaseLock();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendData();
    } else if (e.key === 'ArrowUp') {
      if (sendHistory.length > 0 && !e.shiftKey) {
        e.preventDefault();
        const nextIndex = Math.min(historyIndex + 1, sendHistory.length - 1);
        setHistoryIndex(nextIndex);
        setInputText(sendHistory[nextIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex >= 0) {
        e.preventDefault();
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        if (nextIndex === -1) setInputText('');
        else setInputText(sendHistory[nextIndex]);
      }
    }
  };

  const renderContent = (text) => {
    const safeText = String(text || '');
    if (viewMode === 'hex' || !highlightKeyword) return safeText;
    const parts = safeText.split(new RegExp(`(${highlightKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlightKeyword.toLowerCase()
        ? <span key={i} className={`${highlightColor} font-bold px-0.5 rounded-sm border border-current shadow-[0_0_8px_rgba(255,255,255,0.1)]`}>{part}</span>
        : part
    );
  };

  // Auto-Scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current && !logFilter) {
      const container = logContainerRef.current;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [logs, autoScroll, logFilter]);

  const HIGHLIGHT_PRESETS = [
    'text-emerald-400 bg-emerald-400/40 border-emerald-400/60',
    'text-amber-400 bg-amber-400/40 border-amber-400/60',
    'text-rose-400 bg-rose-400/40 border-rose-400/60',
    'text-cyan-400 bg-cyan-400/40 border-cyan-400/60',
    'text-fuchsia-400 bg-fuchsia-400/40 border-fuchsia-400/60',
    'text-blue-400 bg-blue-400/40 border-blue-400/60',
    'text-orange-400 bg-orange-400/40 border-orange-400/60',
    'text-lime-400 bg-lime-400/40 border-lime-400/60',
  ];

  const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#010101] text-zinc-100 font-sans selection:bg-emerald-500/30 overflow-hidden relative">

      {/* Background Layer */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
         <div className="absolute inset-0 bg-[#111316]"></div>
         <div className="absolute top-[-10%] left-[0%] w-[60%] h-[60%] bg-emerald-500/[0.18] blur-[100px] rounded-full"></div>
         <div className="absolute bottom-[-10%] right-[0%] w-[55%] h-[60%] bg-teal-400/[0.15] blur-[90px] rounded-full"></div>
         <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[50%] h-[50%] bg-emerald-400/[0.08] blur-[80px] rounded-full"></div>
         <div className="absolute inset-0" style={{
           backgroundImage: `
             linear-gradient(to right, rgba(16, 185, 129, 0.15) 1px, transparent 1px),
             linear-gradient(to bottom, rgba(16, 185, 129, 0.15) 1px, transparent 1px)
           `,
           backgroundSize: '50px 50px'
         }}></div>
         <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_50%,_#111316_95%)]"></div>
      </div>

      {/* Main Window */}
      <div className="relative w-[75vw] h-[72vh] max-w-[960px] max-h-[640px] flex flex-col animate-in fade-in zoom-in-95 duration-700
        shadow-[0_0_80px_-20px_rgba(16,185,129,0.2),0_40px_100px_-20px_rgba(0,0,0,1)]
        rounded-2xl border border-white/15 bg-zinc-800/90 backdrop-blur-3xl overflow-hidden ring-1 ring-white/10">

        <div className="absolute inset-0 pointer-events-none border border-emerald-500/10 rounded-2xl opacity-40 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]"></div>

        {/* Title Bar */}
        <div className="h-8 bg-black/40 border-b border-white/10 flex items-center justify-between px-4 select-none flex-none z-50">
            <div className="flex gap-2">
                <div className="size-2.5 rounded-full bg-[#FF5F56] shadow-[0_0_6px_rgba(255,95,86,0.3)]"></div>
                <div className="size-2.5 rounded-full bg-[#FFBD2E] shadow-[0_0_6px_rgba(255,189,46,0.3)]"></div>
                <div className="size-2.5 rounded-full bg-[#27C93F] shadow-[0_0_6px_rgba(39,201,63,0.3)]"></div>
            </div>
            <div className="text-[9px] font-black text-zinc-500 tracking-[0.4em] uppercase flex items-center gap-2 opacity-60 group">
                <Command size={11} className="text-emerald-400 group-hover:scale-110 transition-transform duration-500" />
                SERIAL FLUX PRO <span className="text-[7px] px-1.5 py-0.5 bg-emerald-500/10 rounded text-emerald-400 font-mono tracking-normal shadow-[0_0_10px_rgba(52,211,153,0.2)]">STABLE_V2.2</span>
            </div>
            <div className="w-12"></div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Log Area */}
          <main className="flex-1 flex flex-col min-w-0 relative bg-black/5">

            <div className="absolute top-2.5 left-4 z-20 flex items-center gap-3 px-3 py-1.5 pr-5 rounded-full border border-white/10 backdrop-blur-md bg-zinc-800/80 shadow-xl ring-1 ring-white/5 scale-90 origin-left">
              <div className={`size-6 rounded-full flex items-center justify-center transition-all ${isConnected ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-zinc-800 text-zinc-500'}`}>
                {isConnected ? <Activity size={12} className="animate-pulse" /> : <Zap size={12} />}
              </div>
              <div className="flex flex-col leading-none">
                  <span className={`text-[10px] font-black tracking-widest uppercase ${isConnected ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {isConnected ? 'Active' : 'Offline'}
                  </span>
                  {isConnected && <span className="text-[8px] text-zinc-400 font-mono mt-0.5 uppercase opacity-60">{baudRate} BAUD</span>}
              </div>
            </div>

            <div className="absolute top-2.5 right-4 z-20 flex items-center gap-2 scale-90 origin-right">
                <div className="relative group">
                    <Filter size={12} className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${logFilter ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    <input type="text" value={logFilter} onChange={e => setLogFilter(e.target.value)} placeholder="Live Filter..." className="h-8 pl-9 pr-3 rounded-full border border-white/10 bg-black/60 text-[10px] w-28 focus:w-48 transition-all outline-none focus:border-emerald-500/40 shadow-inner placeholder:opacity-30" />
                </div>

                <div className="flex items-center gap-1.5">
                    <div className="flex bg-black/70 border border-white/10 rounded-full p-0.5 shadow-lg ring-1 ring-white/5">
                        <button onClick={() => setViewMode('ascii')} className={`w-12 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${viewMode === 'ascii' ? 'bg-zinc-700 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}>ASC</button>
                        <button onClick={() => setViewMode('hex')} className={`w-12 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${viewMode === 'hex' ? 'bg-zinc-700 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}>HEX</button>
                    </div>
                    <div className="flex bg-black/70 border border-white/10 rounded-full p-0.5 shadow-lg ring-1 ring-white/5">
                        <button onClick={() => setEncoding('utf-8')} className={`w-15 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${encoding === 'utf-8' ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'}`}>UTF-8</button>
                        <button onClick={() => setEncoding('gbk')} className={`w-15 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${encoding === 'gbk' ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'}`}>GBK</button>
                    </div>
                </div>
                {isConnected && (
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className={`size-8 rounded-full flex items-center justify-center border transition-all shadow-lg ${isPaused ? 'bg-amber-500 text-black border-amber-400 shadow-amber-500/30' : 'bg-black/60 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'}`}
                    title={isPaused ? "Resume" : "Pause"}
                  >
                    {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                  </button>
                )}
                <button
                  onClick={() => {
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                    const content = logs.map(l => `[${dateStr} ${l.timestamp}] ${l.type === 'tx' ? 'TX' : 'RX'}: ${l.text}`).join('\n');
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `serial_log_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                  disabled={logs.length === 0}
                  className="size-8 rounded-full flex items-center justify-center bg-black/60 border border-white/10 text-zinc-400 hover:text-emerald-400 transition-all shadow-lg disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Download Log"
                >
                  <Download size={14} />
                </button>
                <button onClick={() => { if (logs.length === 0 || confirm('Clear all logs?')) setLogs([]); }} className="size-8 rounded-full flex items-center justify-center bg-black/60 border border-white/10 text-zinc-400 hover:text-rose-400 transition-all shadow-lg" title="Clear Log"><Trash2 size={14} /></button>
            </div>

            {/* Log Container */}
            <div
              ref={logContainerRef}
              className="flex-1 pt-14 pb-2 px-5 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed relative"
              style={{ overflowAnchor: 'none' }}
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 select-none transition-all">
                    <Terminal size={56} className="text-emerald-400 mb-4 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]" strokeWidth={1.5} />
                    <p className="tracking-[0.6em] font-black text-sm uppercase text-emerald-500/60">STANDBY_PROBE</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.filter(l => !logFilter || String(l.text).toLowerCase().includes(logFilter.toLowerCase())).map((log) => (
                    <div key={log.id} onClick={() => { navigator.clipboard.writeText(String(log.text)); setCopyFeedback("COPIED!"); setTimeout(()=>setCopyFeedback(null), 1000); }} className="flex items-start gap-2 hover:bg-white/[0.04] -mx-4 px-4 py-0.5 rounded cursor-pointer group transition-colors border border-transparent">
                      {showTimestamp && <span className="text-[10px] text-zinc-400 shrink-0 font-mono select-none tabular-nums">{log.timestamp}</span>}
                      <span className={`shrink-0 text-[10px] font-black px-1.5 rounded-sm border min-w-[22px] text-center ${log.type === 'tx' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_5px_rgba(34,211,238,0.1)]' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_5px_rgba(52,211,153,0.2)]'}`}>{log.type === 'tx' ? 'TX' : 'RX'}</span>
                      <div className={`flex-1 break-all font-medium ${log.type === 'tx' ? 'text-cyan-300' : 'text-emerald-300'}`}>
                        {renderContent(log.text)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-8 flex items-center justify-between px-5 text-[10px] text-zinc-500 select-none border-t border-white/5 bg-black/40">
                <div className="flex items-center gap-8 font-black uppercase tracking-tight opacity-70">
                    <span className="flex items-center gap-3"><span className={`size-1.5 rounded-full transition-all duration-200 ${Date.now() - lastActivity.time < 100 && lastActivity.type === 'rx' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,1)] scale-110' : 'bg-emerald-950'}`}></span> RX: {logs.filter(l => l.type === 'rx').length}</span>
                    <span className="flex items-center gap-3"><span className={`size-1.5 rounded-full transition-all duration-200 ${Date.now() - lastActivity.time < 100 && lastActivity.type === 'tx' ? 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] scale-110' : 'bg-cyan-950'}`}></span> TX: {logs.filter(l => l.type === 'tx').length}</span>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer hover:text-zinc-300 transition-colors group">
                        <div className={`size-2 rounded-full transition-colors ${showTimestamp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-zinc-800'}`}></div>
                        <input type="checkbox" checked={showTimestamp} onChange={e => setShowTimestamp(e.target.checked)} className="hidden" />
                        <Clock size={10} />
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer hover:text-zinc-300 transition-colors group">
                        <div className={`size-2 rounded-full transition-colors ${autoScroll ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-zinc-800'}`}></div>
                        <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="hidden" />
                        <span className="font-bold tracking-widest uppercase text-[9px]">AutoScroll</span>
                    </label>
                </div>
            </div>
          </main>

          <aside className="w-[240px] bg-zinc-800/95 border-l border-white/10 flex flex-col z-20 relative p-3.5 space-y-3.5 overflow-y-auto custom-scrollbar shadow-[-10px_0_30px_rgba(0,0,0,0.3)]">

            <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3 flex items-center gap-2"><Plug size={12} className="text-emerald-400" /> Session</h3>
                <div className="space-y-2.5">
                   <div className="relative w-full" ref={baudRef}>
                      <button
                        onClick={() => !isConnected && setIsBaudDropdownOpen(!isBaudDropdownOpen)}
                        disabled={isConnected}
                        className={`w-full h-full border rounded-lg px-3 py-2 text-[11px] font-mono font-bold flex items-center justify-between transition-all shadow-lg group ${isConnected ? 'bg-zinc-900/50 border-zinc-700/50 cursor-not-allowed opacity-60' : 'bg-black/60 border-white/10 hover:bg-zinc-800'}`}
                      >
                        <span className={isConnected ? 'text-zinc-500' : 'text-zinc-300'}>{baudRate}</span>
                        {!isConnected && <ChevronDown size={11} className={isBaudDropdownOpen ? "rotate-180 transition-transform" : "transition-transform"} />}
                      </button>
                      {isBaudDropdownOpen && !isConnected && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-white/20 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.9)] z-50 max-h-40 overflow-y-auto ring-1 ring-white/10 custom-scrollbar">
                              {COMMON_BAUD_RATES.map(rate => (
                                  <button key={rate} onClick={() => { setBaudRate(rate); setIsBaudDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-[11px] font-mono font-bold hover:bg-emerald-500/20 transition-colors border-b border-white/5 last:border-0">{rate}</button>
                              ))}
                          </div>
                      )}
                   </div>
                   <button
                    onClick={isConnected ? disconnectPort : () => setIsConnectModalOpen(true)}
                    className={`w-full py-2.5 rounded-lg font-black text-[10px] tracking-[0.2em] transition-all shadow-xl active:scale-[0.98] ${isConnected ? 'bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500/20' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-500/10'}`}
                   >
                    {isConnected ? 'DISCONNECT' : 'CONNECT'}
                   </button>
                </div>
            </div>

            <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                 <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2"><List size={12} className="text-emerald-400" /> Macros</h3>
                    <button onClick={() => setIsEditingCmds(!isEditingCmds)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 transition-all border border-white/5 shadow-sm">{isEditingCmds ? <Save size={12} /> : <Edit2 size={12} />}</button>
                 </div>
                 <div className="space-y-2">
                 {isEditingCmds ? (
                   <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                      {quickCommands.map(cmd => (
                        <div key={cmd.id} className="flex items-center gap-1.5 p-2 bg-zinc-800/60 rounded-lg border border-white/10 border-l-2 border-l-emerald-500/50">
                           <input type="text" placeholder="Lbl" value={cmd.label} onChange={e => {const n=[...quickCommands]; n.find(c=>c.id===cmd.id).label=e.target.value; setQuickCommands(n);}} className="w-12 shrink-0 bg-zinc-800 border border-white/10 rounded px-1.5 py-1 text-[10px] focus:border-emerald-500/40 outline-none font-bold text-zinc-200" />
                           <input type="text" placeholder="Cmd" value={cmd.cmd} onChange={e => {const n=[...quickCommands]; n.find(c=>c.id===cmd.id).cmd=e.target.value; setQuickCommands(n);}} className="flex-1 min-w-0 bg-zinc-800 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono font-bold text-emerald-400 focus:border-emerald-500/40 outline-none" />
                           <button onClick={() => setQuickCommands(prev => prev.filter(c => c.id !== cmd.id))} className="size-6 bg-rose-600/10 text-rose-500 rounded flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all border border-rose-500/20 shrink-0"><X size={12}/></button>
                        </div>
                      ))}
                      <button onClick={() => setQuickCommands([...quickCommands, {id: Date.now(), label:'NEW', cmd:''}])} className="w-full py-1.5 border border-dashed border-white/20 rounded-lg text-[9px] text-zinc-500 hover:text-emerald-400 transition-all font-black uppercase">+ ADD MACRO</button>
                   </div>
                 ) : (
                   <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                      {quickCommands.map(cmd => (
                        <button
                            key={cmd.id}
                            onClick={() => sendData(cmd.cmd)}
                            disabled={!isConnected}
                            className="group flex items-center justify-between p-2.5 px-3 bg-zinc-800/70 border border-white/10 rounded-lg hover:border-emerald-500/60 hover:bg-zinc-700/80 transition-all disabled:opacity-40 active:translate-x-1 shadow-sm text-left"
                        >
                           <div className="overflow-hidden min-w-0">
                               <div className="text-[11px] font-black text-zinc-200 uppercase tracking-widest truncate">{cmd.label}</div>
                               <div className="text-[10px] font-mono font-medium text-emerald-400/80 truncate mt-0.5">{cmd.cmd}</div>
                           </div>
                           <ChevronRight size={12} className="text-zinc-600 group-hover:text-emerald-400 transition-colors shrink-0" />
                        </button>
                      ))}
                   </div>
                 )}
                 </div>
            </div>

            <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2.5 flex items-center gap-2"><Highlighter size={12} className="text-emerald-400" /> Highlighting</h3>
                <div className="space-y-3">
                    <input type="text" value={highlightKeyword} onChange={e => setHighlightKeyword(e.target.value)} placeholder="Keyword..." className="w-full bg-zinc-800/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-emerald-500/40 transition-all font-bold text-emerald-400" />
                    <div className="flex gap-1.5 justify-between px-0.5">
                        {HIGHLIGHT_PRESETS.map((c, i) => (
                            <button
                                key={i}
                                onClick={() => setHighlightColor(c)}
                                className={`size-5 rounded-sm transition-all border-2 ${c.split(' ')[1]} ${highlightColor === c ? 'border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.2)]' : 'border-transparent opacity-70 hover:opacity-100 hover:scale-105'}`}
                            ></button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between px-1">
                    <div className="flex gap-2">
                        <button onClick={() => setAppendCRC(!appendCRC)} className={`px-2 py-0.5 rounded border text-[8px] font-black transition-all ${appendCRC ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500'}`}>CRC16</button>
                        <button onClick={() => setUseHexSend(!useHexSend)} className={`px-2 py-0.5 rounded border text-[8px] font-black transition-all ${useHexSend ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500'}`}>HEX</button>
                    </div>
                    <div className="flex bg-zinc-700/30 border border-zinc-600/50 rounded overflow-hidden">
                        {[ {label:'\\n', val:'\\n'}, {label:'\\r\\n', val:'\\r\\n'} ].map(opt => (
                            <button key={opt.val} onClick={() => setLineEnding(opt.val)} className={`px-2 py-0.5 text-[8px] font-black transition-all ${lineEnding === opt.val ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-300 hover:text-white'}`}>{opt.label}</button>
                        ))}
                    </div>
                </div>

                {/* Timer Send */}
                <div className="flex items-center gap-2 px-1">
                    <button
                      onClick={() => setTimerEnabled(!timerEnabled)}
                      disabled={!isConnected || !inputText}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[8px] font-black transition-all ${timerEnabled ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse' : 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500'} disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      <Timer size={10} /> {timerEnabled ? 'STOP' : 'TIMER'}
                    </button>
                    <input
                      type="text"
                      value={timerInterval}
                      onChange={e => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setTimerInterval(val === '' ? 100 : Math.max(100, parseInt(val)));
                      }}
                      className="w-16 bg-zinc-700/50 border border-zinc-600/50 rounded px-2 py-1 text-[10px] font-mono text-zinc-200 text-center outline-none focus:border-emerald-500/40"
                    />
                    <span className="text-[8px] text-zinc-400 font-bold">ms</span>
                </div>

                <div className="relative group">
                    <textarea
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter to send, Shift+Enter newline, ↑↓ history"
                        className="w-full h-28 bg-zinc-700/40 border border-zinc-600/50 rounded-xl p-3 text-[12px] font-mono focus:outline-none focus:border-emerald-500/40 transition-all resize-none placeholder:text-zinc-500 placeholder:text-[10px] text-emerald-100"
                    />
                </div>
                <button
                  onClick={() => sendData()}
                  disabled={!isConnected}
                  title={!isConnected ? "Connect first" : "Send data"}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white text-[10px] font-black tracking-[0.3em] rounded-xl transition-all shadow-lg shadow-emerald-900/20 disabled:shadow-none flex items-center justify-center gap-2.5 active:scale-95 group"
                >
                    <Send size={15} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    {isConnected ? 'SEND' : 'NOT CONNECTED'}
                </button>
            </div>
          </aside>
        </div>

        {/* Feedback Toast */}
        {copyFeedback && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-zinc-800 border border-emerald-500/40 text-emerald-400 px-6 py-2 rounded-full text-[11px] font-black tracking-[0.3em] shadow-[0_15px_40px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-bottom-4">
                {copyFeedback}
            </div>
        )}
      </div>

      {/* Connect Modal */}
      {isConnectModalOpen && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="w-[540px] bg-[#0c0c0e] border border-white/20 rounded-[2.5rem] shadow-2xl overflow-hidden ring-1 ring-white/10">
                <div className="p-8 border-b border-white/10 flex items-center justify-between bg-zinc-800/50">
                    <div className="flex items-center gap-5">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-inner">
                            <Usb className="text-emerald-400" size={24} />
                        </div>
                        <div>
                            <h3 className="font-black text-sm tracking-[0.3em] uppercase">Hardware Hub</h3>
                            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1 opacity-60">Authorize port sessions</p>
                        </div>
                    </div>
                    <button onClick={() => setIsConnectModalOpen(false)} className="p-3 bg-white/5 hover:bg-rose-500/20 hover:text-rose-500 rounded-full text-zinc-500 transition-all border border-white/5 flex items-center justify-center"><X size={18} /></button>
                </div>

                <div className="p-8 bg-black/20">
                    <div className="relative group mb-8">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                        <input type="text" placeholder="Filter authorized devices..." value={portSearchQuery} onChange={e => setPortSearchQuery(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-xs outline-none focus:border-emerald-500/40 transition-all shadow-inner tracking-wider" />
                    </div>

                    <div className="max-h-80 overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-2">
                        {availablePorts.length === 0 ? (
                            <div className="text-center py-16">
                                <Monitor size={64} className="mx-auto text-zinc-800 mb-6 opacity-30" />
                                <div className="text-zinc-600 text-[10px] font-black tracking-[0.4em] uppercase opacity-40">No Hardware Linked</div>
                            </div>
                        ) : (
                            availablePorts.map((p, i) => (
                                <button key={i} onClick={() => openPort(p)} className="w-full text-left p-5 bg-zinc-800/50 border border-white/5 hover:border-emerald-500/50 rounded-3xl group transition-all flex items-center justify-between shadow-lg hover:bg-zinc-700/60">
                                    <div className="flex items-center gap-6">
                                        <div className="w-11 h-11 rounded-2xl bg-black/60 flex items-center justify-center group-hover:text-emerald-400 group-hover:bg-emerald-500/10 transition-all border border-white/5">
                                            <Usb size={20} />
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black group-hover:text-emerald-400 transition-colors uppercase tracking-tighter leading-none">Endpoint#{i+1}</div>
                                            <div className="text-[10px] font-mono text-zinc-500 mt-2 uppercase tracking-tight opacity-70">VID:{p.getInfo().usbVendorId?.toString(16).padStart(4,'0') || '0000'} &nbsp; PID:{p.getInfo().usbProductId?.toString(16).padStart(4,'0') || '0000'}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={20} className="text-zinc-800 group-hover:text-emerald-400 transition-all group-hover:translate-x-2" />
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div className="p-8 bg-[#0a0a0c] border-t border-white/10">
                    <button
                      onClick={() => {
                        navigator.serial.requestPort()
                          .then(p => {
                            openPort(p);
                            updatePorts();
                          })
                          .catch(() => {});
                      }}
                      className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-[1.5rem] text-[11px] font-black tracking-[0.4em] transition-all shadow-2xl shadow-emerald-900/40 flex items-center justify-center gap-4 hover:scale-[1.01] active:scale-98"
                    >
                        <Search size={20} /> SCAN FOR HARDWARE
                    </button>
                </div>
            </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.08); border-radius: 10px; border: 1px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(16, 185, 129, 0.25); }
      `}</style>
    </div>
  );
}
