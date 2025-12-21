import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Terminal, Download, Trash2, Play, Highlighter, Send,
  Zap, Activity, Command, Copy, Plus, X,
  Pause, Edit2, Save, Plug, Search, Usb, Filter,
  ChevronDown, Check, ShieldCheck, List, Monitor,
  ChevronRight, Timer, Clock, Sun, Moon
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
  // const [theme, setTheme] = usePersistedState('sf_theme', 'dark'); // 'dark' | 'light'
  // const isDark = theme === 'dark';
  const isDark = true; // 暂时禁用浅色主题

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

  // Theme colors
  const t = {
    // Background
    pageBg: isDark ? 'bg-[#010101]' : 'bg-gradient-to-br from-slate-100 via-purple-50 to-emerald-50',
    windowBg: isDark ? 'bg-zinc-800/90' : 'bg-white/95',
    panelBg: isDark ? 'bg-zinc-800/60' : 'bg-white/80',
    sideBg: isDark ? 'bg-zinc-800/95' : 'bg-slate-50/95',
    inputBg: isDark ? 'bg-zinc-700/40' : 'bg-white',
    logBg: isDark ? 'bg-black/5' : 'bg-slate-50/50',
    // Text
    text: isDark ? 'text-zinc-100' : 'text-slate-800',
    textMuted: isDark ? 'text-zinc-400' : 'text-slate-500',
    textDim: isDark ? 'text-zinc-500' : 'text-slate-400',
    // Borders
    border: isDark ? 'border-white/10' : 'border-slate-200',
    borderHover: isDark ? 'border-white/20' : 'border-purple-300',
    // Accent (purple for light, emerald for dark)
    accent: isDark ? 'emerald' : 'purple',
    accentText: isDark ? 'text-emerald-400' : 'text-purple-600',
    accentBg: isDark ? 'bg-emerald-500' : 'bg-purple-500',
    accentBgLight: isDark ? 'bg-emerald-500/20' : 'bg-purple-500/20',
    // TX/RX
    txText: isDark ? 'text-cyan-400' : 'text-blue-600',
    txBg: isDark ? 'bg-cyan-500/10' : 'bg-blue-100',
    rxText: isDark ? 'text-emerald-400' : 'text-emerald-600',
    rxBg: isDark ? 'bg-emerald-500/10' : 'bg-emerald-100',
    // Button
    btnPrimary: isDark ? 'from-emerald-600 to-emerald-500' : 'from-purple-500 to-emerald-500',
    btnPrimaryHover: isDark ? 'hover:from-emerald-500 hover:to-emerald-400' : 'hover:from-purple-400 hover:to-emerald-400',
  };

  return (
    <div className={`flex h-screen w-full items-center justify-center ${t.pageBg} ${t.text} font-sans selection:bg-purple-500/30 overflow-hidden relative transition-colors duration-300`}>

      {/* Background Layer */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
         {isDark ? (
           <>
             <div className="absolute inset-0 bg-[#111316]"></div>
             <div className="absolute top-[-10%] left-[0%] w-[60%] h-[60%] bg-emerald-500/[0.18] blur-[100px] rounded-full"></div>
             <div className="absolute bottom-[-10%] right-[0%] w-[55%] h-[60%] bg-teal-400/[0.15] blur-[90px] rounded-full"></div>
             <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[50%] h-[50%] bg-emerald-400/[0.08] blur-[80px] rounded-full"></div>
             <div className="absolute inset-0" style={{
               backgroundImage: `linear-gradient(to right, rgba(16, 185, 129, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(16, 185, 129, 0.15) 1px, transparent 1px)`,
               backgroundSize: '50px 50px'
             }}></div>
             <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_50%,_#111316_95%)]"></div>
           </>
         ) : (
           <>
             <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-300/40 blur-[100px] rounded-full"></div>
             <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-300/40 blur-[100px] rounded-full"></div>
             <div className="absolute top-[30%] right-[20%] w-[30%] h-[30%] bg-violet-200/30 blur-[80px] rounded-full"></div>
           </>
         )}
      </div>

      {/* Main Window */}
      <div className={`relative w-[75vw] h-[72vh] max-w-[960px] max-h-[640px] flex flex-col animate-in fade-in zoom-in-95 duration-700
        ${isDark ? 'shadow-[0_0_80px_-20px_rgba(16,185,129,0.2),0_40px_100px_-20px_rgba(0,0,0,1)]' : 'shadow-[0_0_60px_-20px_rgba(139,92,246,0.3),0_25px_80px_-20px_rgba(0,0,0,0.2)]'}
        rounded-2xl ${t.border} border ${t.windowBg} backdrop-blur-3xl overflow-hidden ring-1 ${isDark ? 'ring-white/10' : 'ring-purple-200/50'} transition-colors duration-300`}>

        <div className={`absolute inset-0 pointer-events-none border ${isDark ? 'border-emerald-500/10' : 'border-purple-300/20'} rounded-2xl opacity-40`}></div>

        {/* Title Bar */}
        <div className={`h-8 ${isDark ? 'bg-black/40' : 'bg-white/60'} border-b ${t.border} flex items-center justify-between px-4 select-none flex-none z-50`}>
            <div className="flex gap-2">
                <div className="size-2.5 rounded-full bg-[#FF5F56] shadow-[0_0_6px_rgba(255,95,86,0.3)]"></div>
                <div className="size-2.5 rounded-full bg-[#FFBD2E] shadow-[0_0_6px_rgba(255,189,46,0.3)]"></div>
                <div className="size-2.5 rounded-full bg-[#27C93F] shadow-[0_0_6px_rgba(39,201,63,0.3)]"></div>
            </div>
            <div className={`text-[9px] font-black ${t.textDim} tracking-[0.4em] uppercase flex items-center gap-2 opacity-60 group`}>
                <Command size={11} className={t.accentText} />
                SERIAL FLUX <span className={`text-[7px] px-1.5 py-0.5 ${t.accentBgLight} rounded ${t.accentText} font-mono tracking-normal`}>V2.3</span>
            </div>
            {/* 暂时隐藏主题切换按钮
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className={`p-1.5 rounded-full ${isDark ? 'hover:bg-white/10' : 'hover:bg-purple-100'} transition-colors`}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun size={12} className="text-amber-400" /> : <Moon size={12} className="text-purple-500" />}
            </button>
            */}
            <div className="w-6"></div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Log Area */}
          <main className={`flex-1 flex flex-col min-w-0 relative ${t.logBg}`}>

            <div className={`absolute top-2.5 left-4 z-20 flex items-center gap-3 px-3 py-1.5 pr-5 rounded-full border ${t.border} backdrop-blur-md ${isDark ? 'bg-zinc-800/80' : 'bg-white/80'} shadow-xl ring-1 ${isDark ? 'ring-white/5' : 'ring-purple-100'} scale-90 origin-left`}>
              <div className={`size-6 rounded-full flex items-center justify-center transition-all ${isConnected ? `${t.accentBg} text-white shadow-[0_0_15px_rgba(16,185,129,0.5)]` : isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-slate-200 text-slate-400'}`}>
                {isConnected ? <Activity size={12} className="animate-pulse" /> : <Zap size={12} />}
              </div>
              <div className="flex flex-col leading-none">
                  <span className={`text-[10px] font-black tracking-widest uppercase ${isConnected ? t.accentText : t.textDim}`}>
                    {isConnected ? 'Active' : 'Offline'}
                  </span>
                  {isConnected && <span className={`text-[8px] ${t.textMuted} font-mono mt-0.5 uppercase opacity-60`}>{baudRate} BAUD</span>}
              </div>
            </div>

            <div className="absolute top-2.5 right-4 z-20 flex items-center gap-2 scale-90 origin-right">
                <div className="relative group">
                    <Filter size={12} className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${logFilter ? t.accentText : t.textDim}`} />
                    <input type="text" value={logFilter} onChange={e => setLogFilter(e.target.value)} placeholder="Filter..." className={`h-8 pl-9 pr-3 rounded-full border ${t.border} ${isDark ? 'bg-black/60' : 'bg-white/80'} text-[10px] w-28 focus:w-48 transition-all outline-none focus:border-purple-400 shadow-inner placeholder:opacity-50`} />
                </div>

                <div className="flex items-center gap-1.5">
                    <div className={`flex ${isDark ? 'bg-black/70' : 'bg-white/80'} border ${t.border} rounded-full p-0.5 shadow-lg`}>
                        <button onClick={() => setViewMode('ascii')} className={`w-12 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${viewMode === 'ascii' ? (isDark ? 'bg-zinc-700 text-white' : 'bg-purple-100 text-purple-700') : t.textDim + ' hover:opacity-80'}`}>ASC</button>
                        <button onClick={() => setViewMode('hex')} className={`w-12 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${viewMode === 'hex' ? (isDark ? 'bg-zinc-700 text-white' : 'bg-purple-100 text-purple-700') : t.textDim + ' hover:opacity-80'}`}>HEX</button>
                    </div>
                    <div className={`flex ${isDark ? 'bg-black/70' : 'bg-white/80'} border ${t.border} rounded-full p-0.5 shadow-lg`}>
                        <button onClick={() => setEncoding('utf-8')} className={`px-2 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${encoding === 'utf-8' ? t.accentBgLight + ' ' + t.accentText : t.textDim}`}>UTF-8</button>
                        <button onClick={() => setEncoding('gbk')} className={`px-2 py-1 rounded-full text-[10px] font-black tracking-wider transition-all ${encoding === 'gbk' ? t.accentBgLight + ' ' + t.accentText : t.textDim}`}>GBK</button>
                    </div>
                </div>
                {isConnected && (
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className={`size-8 rounded-full flex items-center justify-center border transition-all shadow-lg ${isPaused ? 'bg-amber-500 text-white border-amber-400' : isDark ? 'bg-black/60 border-white/10 text-zinc-400 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}
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
                  className={`size-8 rounded-full flex items-center justify-center ${isDark ? 'bg-black/60 border-white/10' : 'bg-white border-slate-200'} border ${t.textMuted} hover:${t.accentText} transition-all shadow-lg disabled:opacity-30 disabled:cursor-not-allowed`}
                  title="Download Log"
                >
                  <Download size={14} />
                </button>
                <button onClick={() => { if (logs.length === 0 || confirm('Clear all logs?')) setLogs([]); }} className={`size-8 rounded-full flex items-center justify-center ${isDark ? 'bg-black/60 border-white/10' : 'bg-white border-slate-200'} border ${t.textMuted} hover:text-rose-500 transition-all shadow-lg`} title="Clear Log"><Trash2 size={14} /></button>
            </div>

            {/* Log Container */}
            <div
              ref={logContainerRef}
              className="flex-1 pt-14 pb-2 px-5 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed relative"
              style={{ overflowAnchor: 'none' }}
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 select-none transition-all">
                    <Terminal size={56} className={t.accentText} strokeWidth={1.5} />
                    <p className={`tracking-[0.6em] font-black text-sm uppercase mt-4 ${t.textDim}`}>STANDBY</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.filter(l => !logFilter || String(l.text).toLowerCase().includes(logFilter.toLowerCase())).map((log) => (
                    <div key={log.id} onClick={() => { navigator.clipboard.writeText(String(log.text)); setCopyFeedback("COPIED!"); setTimeout(()=>setCopyFeedback(null), 1000); }} className={`flex items-start gap-2 ${isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-purple-50'} -mx-4 px-4 py-0.5 rounded cursor-pointer group transition-colors`}>
                      {showTimestamp && <span className={`text-[10px] ${t.textMuted} shrink-0 font-mono select-none tabular-nums`}>{log.timestamp}</span>}
                      <span className={`shrink-0 text-[10px] font-black px-1.5 rounded-sm border min-w-[22px] text-center ${log.type === 'tx' ? `${t.txText} ${t.txBg} border-current/20` : `${t.rxText} ${t.rxBg} border-current/20`}`}>{log.type === 'tx' ? 'TX' : 'RX'}</span>
                      <div className={`flex-1 break-all font-medium ${log.type === 'tx' ? (isDark ? 'text-cyan-300' : 'text-blue-700') : (isDark ? 'text-emerald-300' : 'text-emerald-700')}`}>
                        {renderContent(log.text)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`h-8 flex items-center justify-between px-5 text-[10px] ${t.textDim} select-none border-t ${t.border} ${isDark ? 'bg-black/40' : 'bg-white/60'}`}>
                <div className="flex items-center gap-8 font-black uppercase tracking-tight opacity-70">
                    <span className="flex items-center gap-3"><span className={`size-1.5 rounded-full transition-all duration-200 ${Date.now() - lastActivity.time < 100 && lastActivity.type === 'rx' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,1)] scale-110' : isDark ? 'bg-emerald-950' : 'bg-emerald-200'}`}></span> RX: {logs.filter(l => l.type === 'rx').length}</span>
                    <span className="flex items-center gap-3"><span className={`size-1.5 rounded-full transition-all duration-200 ${Date.now() - lastActivity.time < 100 && lastActivity.type === 'tx' ? 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] scale-110' : isDark ? 'bg-cyan-950' : 'bg-blue-200'}`}></span> TX: {logs.filter(l => l.type === 'tx').length}</span>
                </div>
                <div className="flex items-center gap-4">
                    <label className={`flex items-center gap-2 cursor-pointer ${isDark ? 'hover:text-zinc-300' : 'hover:text-slate-700'} transition-colors group`}>
                        <div className={`size-2 rounded-full transition-colors ${showTimestamp ? t.accentBg : isDark ? 'bg-zinc-800' : 'bg-slate-300'}`}></div>
                        <input type="checkbox" checked={showTimestamp} onChange={e => setShowTimestamp(e.target.checked)} className="hidden" />
                        <Clock size={10} />
                    </label>
                    <label className={`flex items-center gap-2 cursor-pointer ${isDark ? 'hover:text-zinc-300' : 'hover:text-slate-700'} transition-colors group`}>
                        <div className={`size-2 rounded-full transition-colors ${autoScroll ? t.accentBg : isDark ? 'bg-zinc-800' : 'bg-slate-300'}`}></div>
                        <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="hidden" />
                        <span className="font-bold tracking-widest uppercase text-[9px]">Auto</span>
                    </label>
                </div>
            </div>
          </main>

          <aside className={`w-[240px] ${t.sideBg} border-l ${t.border} flex flex-col z-20 relative p-3.5 space-y-3.5 overflow-y-auto custom-scrollbar ${isDark ? 'shadow-[-10px_0_30px_rgba(0,0,0,0.3)]' : 'shadow-[-5px_0_20px_rgba(0,0,0,0.05)]'} transition-colors duration-300`}>

            <div className={`${t.panelBg} border ${t.border} rounded-xl p-3 ${isDark ? 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'shadow-sm'}`}>
                <h3 className={`text-[10px] font-black ${t.textDim} uppercase tracking-[0.2em] mb-3 flex items-center gap-2`}><Plug size={12} className={t.accentText} /> Session</h3>
                <div className="space-y-2.5">
                   <div className="relative w-full" ref={baudRef}>
                      <button
                        onClick={() => !isConnected && setIsBaudDropdownOpen(!isBaudDropdownOpen)}
                        disabled={isConnected}
                        className={`w-full h-full border rounded-lg px-3 py-2 text-[11px] font-mono font-bold flex items-center justify-between transition-all shadow-lg group ${isConnected ? (isDark ? 'bg-zinc-900/50 border-zinc-700/50' : 'bg-slate-100 border-slate-200') + ' cursor-not-allowed opacity-60' : (isDark ? 'bg-black/60 border-white/10 hover:bg-zinc-800' : 'bg-white border-slate-200 hover:bg-slate-50')}`}
                      >
                        <span className={isConnected ? (isDark ? 'text-zinc-500' : 'text-slate-400') : (isDark ? 'text-zinc-300' : 'text-slate-700')}>{baudRate}</span>
                        {!isConnected && <ChevronDown size={11} className={`${isDark ? 'text-zinc-400' : 'text-slate-500'} ${isBaudDropdownOpen ? "rotate-180 transition-transform" : "transition-transform"}`} />}
                      </button>
                      {isBaudDropdownOpen && !isConnected && (
                          <div className={`absolute top-full left-0 right-0 mt-1 ${isDark ? 'bg-zinc-800 border-white/20 ring-white/10' : 'bg-white border-slate-200 ring-purple-100'} border rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.3)] z-50 max-h-40 overflow-y-auto ring-1 custom-scrollbar`}>
                              {COMMON_BAUD_RATES.map(rate => (
                                  <button key={rate} onClick={() => { setBaudRate(rate); setIsBaudDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-[11px] font-mono font-bold ${isDark ? 'hover:bg-emerald-500/20 border-white/5' : 'hover:bg-purple-50 border-slate-100 text-slate-700'} transition-colors border-b last:border-0`}>{rate}</button>
                              ))}
                          </div>
                      )}
                   </div>
                   <button
                    onClick={isConnected ? disconnectPort : () => setIsConnectModalOpen(true)}
                    className={`w-full py-2.5 rounded-lg font-black text-[10px] tracking-[0.2em] transition-all shadow-xl active:scale-[0.98] ${isConnected ? 'bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500/20' : (isDark ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/10' : 'bg-gradient-to-r from-purple-500 to-emerald-500 hover:from-purple-400 hover:to-emerald-400 shadow-purple-500/10') + ' text-white'}`}
                   >
                    {isConnected ? 'DISCONNECT' : 'CONNECT'}
                   </button>
                </div>
            </div>

            <div className={`${t.panelBg} border ${t.border} rounded-xl p-3 ${isDark ? 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'shadow-sm'}`}>
                 <div className="flex items-center justify-between mb-3">
                    <h3 className={`text-[10px] font-black ${t.textDim} uppercase tracking-[0.2em] flex items-center gap-2`}><List size={12} className={t.accentText} /> Macros</h3>
                    <button onClick={() => setIsEditingCmds(!isEditingCmds)} className={`p-1.5 rounded-lg ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/5' : 'bg-slate-100 hover:bg-slate-200 border-slate-200'} ${t.textMuted} transition-all border shadow-sm`}>{isEditingCmds ? <Save size={12} /> : <Edit2 size={12} />}</button>
                 </div>
                 <div className="space-y-2">
                 {isEditingCmds ? (
                   <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                      {quickCommands.map(cmd => (
                        <div key={cmd.id} className={`flex items-center gap-1.5 p-2 ${isDark ? 'bg-zinc-800/60 border-white/10 border-l-emerald-500/50' : 'bg-white border-slate-200 border-l-purple-400'} rounded-lg border border-l-2`}>
                           <input type="text" placeholder="Lbl" value={cmd.label} onChange={e => {const n=[...quickCommands]; n.find(c=>c.id===cmd.id).label=e.target.value; setQuickCommands(n);}} className={`w-12 shrink-0 ${isDark ? 'bg-zinc-800 border-white/10 text-zinc-200 focus:border-emerald-500/40' : 'bg-slate-50 border-slate-200 text-slate-700 focus:border-purple-400'} border rounded px-1.5 py-1 text-[10px] outline-none font-bold`} />
                           <input type="text" placeholder="Cmd" value={cmd.cmd} onChange={e => {const n=[...quickCommands]; n.find(c=>c.id===cmd.id).cmd=e.target.value; setQuickCommands(n);}} className={`flex-1 min-w-0 ${isDark ? 'bg-zinc-800 border-white/10 text-emerald-400 focus:border-emerald-500/40' : 'bg-slate-50 border-slate-200 text-purple-600 focus:border-purple-400'} border rounded px-1.5 py-1 text-[10px] font-mono font-bold outline-none`} />
                           <button onClick={() => setQuickCommands(prev => prev.filter(c => c.id !== cmd.id))} className="size-6 bg-rose-600/10 text-rose-500 rounded flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all border border-rose-500/20 shrink-0"><X size={12}/></button>
                        </div>
                      ))}
                      <button onClick={() => setQuickCommands([...quickCommands, {id: Date.now(), label:'NEW', cmd:''}])} className={`w-full py-1.5 border border-dashed ${isDark ? 'border-white/20 text-zinc-500 hover:text-emerald-400' : 'border-slate-300 text-slate-400 hover:text-purple-500'} rounded-lg text-[9px] transition-all font-black uppercase`}>+ ADD MACRO</button>
                   </div>
                 ) : (
                   <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                      {quickCommands.map(cmd => (
                        <button
                            key={cmd.id}
                            onClick={() => sendData(cmd.cmd)}
                            disabled={!isConnected}
                            className={`group flex items-center justify-between p-2.5 px-3 ${isDark ? 'bg-zinc-800/70 border-white/10 hover:border-emerald-500/60 hover:bg-zinc-700/80' : 'bg-white border-slate-200 hover:border-purple-400 hover:bg-purple-50'} border rounded-lg transition-all disabled:opacity-40 active:translate-x-1 shadow-sm text-left`}
                        >
                           <div className="overflow-hidden min-w-0">
                               <div className={`text-[11px] font-black ${isDark ? 'text-zinc-200' : 'text-slate-700'} uppercase tracking-widest truncate`}>{cmd.label}</div>
                               <div className={`text-[10px] font-mono font-medium ${isDark ? 'text-emerald-400/80' : 'text-purple-500'} truncate mt-0.5`}>{cmd.cmd}</div>
                           </div>
                           <ChevronRight size={12} className={`${isDark ? 'text-zinc-600 group-hover:text-emerald-400' : 'text-slate-400 group-hover:text-purple-500'} transition-colors shrink-0`} />
                        </button>
                      ))}
                   </div>
                 )}
                 </div>
            </div>

            <div className={`${t.panelBg} border ${t.border} rounded-xl p-3 ${isDark ? 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'shadow-sm'}`}>
                <h3 className={`text-[10px] font-black ${t.textDim} uppercase tracking-[0.2em] mb-2.5 flex items-center gap-2`}><Highlighter size={12} className={t.accentText} /> Highlighting</h3>
                <div className="space-y-3">
                    <input type="text" value={highlightKeyword} onChange={e => setHighlightKeyword(e.target.value)} placeholder="Keyword..." className={`w-full ${isDark ? 'bg-zinc-800/80 border-white/10 text-emerald-400 focus:border-emerald-500/40' : 'bg-white border-slate-200 text-purple-600 focus:border-purple-400'} border rounded-lg px-2.5 py-1.5 text-[11px] outline-none transition-all font-bold`} />
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

            <div className={`mt-auto space-y-2 border-t ${t.border} pt-3`}>
                <div className="flex items-center justify-between px-1">
                    <div className="flex gap-2">
                        <button onClick={() => setAppendCRC(!appendCRC)} className={`px-2 py-0.5 rounded border text-[8px] font-black transition-all ${appendCRC ? (isDark ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-purple-100 text-purple-600 border-purple-300') : (isDark ? 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500' : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300')}`}>CRC16</button>
                        <button onClick={() => setUseHexSend(!useHexSend)} className={`px-2 py-0.5 rounded border text-[8px] font-black transition-all ${useHexSend ? (isDark ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-purple-100 text-purple-600 border-purple-300') : (isDark ? 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500' : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300')}`}>HEX</button>
                    </div>
                    <div className={`flex ${isDark ? 'bg-zinc-700/30 border-zinc-600/50' : 'bg-slate-100 border-slate-200'} border rounded overflow-hidden`}>
                        {[ {label:'\\n', val:'\\n'}, {label:'\\r\\n', val:'\\r\\n'} ].map(opt => (
                            <button key={opt.val} onClick={() => setLineEnding(opt.val)} className={`px-2 py-0.5 text-[8px] font-black transition-all ${lineEnding === opt.val ? (isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-100 text-purple-600') : (isDark ? 'text-zinc-300 hover:text-white' : 'text-slate-500 hover:text-slate-700')}`}>{opt.label}</button>
                        ))}
                    </div>
                </div>

                {/* Timer Send */}
                <div className="flex items-center gap-2 px-1">
                    <button
                      onClick={() => setTimerEnabled(!timerEnabled)}
                      disabled={!isConnected || !inputText}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[8px] font-black transition-all ${timerEnabled ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse' : (isDark ? 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 hover:border-zinc-500' : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300')} disabled:opacity-30 disabled:cursor-not-allowed`}
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
                      className={`w-16 ${isDark ? 'bg-zinc-700/50 border-zinc-600/50 text-zinc-200 focus:border-emerald-500/40' : 'bg-white border-slate-200 text-slate-700 focus:border-purple-400'} border rounded px-2 py-1 text-[10px] font-mono text-center outline-none`}
                    />
                    <span className={`text-[8px] ${t.textMuted} font-bold`}>ms</span>
                </div>

                <div className="relative group">
                    <textarea
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter to send, Shift+Enter newline, ↑↓ history"
                        className={`w-full h-28 ${isDark ? 'bg-zinc-700/40 border-zinc-600/50 text-emerald-100 focus:border-emerald-500/40 placeholder:text-zinc-500' : 'bg-white border-slate-200 text-slate-800 focus:border-purple-400 placeholder:text-slate-400'} border rounded-xl p-3 text-[12px] font-mono focus:outline-none transition-all resize-none placeholder:text-[10px]`}
                    />
                </div>
                <button
                  onClick={() => sendData()}
                  disabled={!isConnected}
                  title={!isConnected ? "Connect first" : "Send data"}
                  className={`w-full py-3.5 bg-gradient-to-r ${t.btnPrimary} ${t.btnPrimaryHover} disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white text-[10px] font-black tracking-[0.3em] rounded-xl transition-all shadow-lg ${isDark ? 'shadow-emerald-900/20' : 'shadow-purple-500/20'} disabled:shadow-none flex items-center justify-center gap-2.5 active:scale-95 group`}
                >
                    <Send size={15} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    {isConnected ? 'SEND' : 'NOT CONNECTED'}
                </button>
            </div>
          </aside>
        </div>

        {/* Feedback Toast */}
        {copyFeedback && (
            <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-[100] ${isDark ? 'bg-zinc-800 border-emerald-500/40 text-emerald-400' : 'bg-white border-purple-300 text-purple-600'} border px-6 py-2 rounded-full text-[11px] font-black tracking-[0.3em] shadow-[0_15px_40px_rgba(0,0,0,0.3)] animate-in fade-in slide-in-from-bottom-4`}>
                {copyFeedback}
            </div>
        )}
      </div>

      {/* Connect Modal */}
      {isConnectModalOpen && (
        <div className={`absolute inset-0 z-[200] flex items-center justify-center ${isDark ? 'bg-black/80' : 'bg-slate-900/50'} backdrop-blur-xl animate-in fade-in duration-300`}>
            <div className={`w-[540px] ${isDark ? 'bg-[#0c0c0e] border-white/20 ring-white/10' : 'bg-white border-purple-200 ring-purple-100'} border rounded-[2.5rem] shadow-2xl overflow-hidden ring-1`}>
                <div className={`p-8 border-b ${isDark ? 'border-white/10 bg-zinc-800/50' : 'border-purple-100 bg-gradient-to-r from-purple-50 to-emerald-50'} flex items-center justify-between`}>
                    <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl ${isDark ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-purple-100 border-purple-200'} flex items-center justify-center border shadow-inner`}>
                            <Usb className={isDark ? 'text-emerald-400' : 'text-purple-500'} size={24} />
                        </div>
                        <div>
                            <h3 className={`font-black text-sm tracking-[0.3em] uppercase ${isDark ? '' : 'text-slate-800'}`}>Hardware Hub</h3>
                            <p className={`text-[10px] ${isDark ? 'text-zinc-500' : 'text-slate-500'} font-bold uppercase tracking-widest mt-1 opacity-60`}>Authorize port sessions</p>
                        </div>
                    </div>
                    <button onClick={() => setIsConnectModalOpen(false)} className={`p-3 ${isDark ? 'bg-white/5 border-white/5 text-zinc-500' : 'bg-slate-100 border-slate-200 text-slate-400'} hover:bg-rose-500/20 hover:text-rose-500 rounded-full transition-all border flex items-center justify-center`}><X size={18} /></button>
                </div>

                <div className={`p-8 ${isDark ? 'bg-black/20' : 'bg-white'}`}>
                    <div className="relative group mb-8">
                        <Search size={18} className={`absolute left-4 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-600' : 'text-slate-400'}`} />
                        <input type="text" placeholder="Filter authorized devices..." value={portSearchQuery} onChange={e => setPortSearchQuery(e.target.value)} className={`w-full ${isDark ? 'bg-black/40 border-white/10 focus:border-emerald-500/40' : 'bg-slate-50 border-slate-200 focus:border-purple-400 text-slate-700'} border rounded-2xl pl-12 pr-4 py-4 text-xs outline-none transition-all shadow-inner tracking-wider`} />
                    </div>

                    <div className="max-h-80 overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-2">
                        {availablePorts.length === 0 ? (
                            <div className="text-center py-16">
                                <Monitor size={64} className={`mx-auto ${isDark ? 'text-zinc-800' : 'text-slate-300'} mb-6 opacity-30`} />
                                <div className={`${isDark ? 'text-zinc-600' : 'text-slate-400'} text-[10px] font-black tracking-[0.4em] uppercase opacity-40`}>No Hardware Linked</div>
                            </div>
                        ) : (
                            availablePorts.map((p, i) => (
                                <button key={i} onClick={() => openPort(p)} className={`w-full text-left p-5 ${isDark ? 'bg-zinc-800/50 border-white/5 hover:border-emerald-500/50 hover:bg-zinc-700/60' : 'bg-slate-50 border-slate-200 hover:border-purple-400 hover:bg-purple-50'} border rounded-3xl group transition-all flex items-center justify-between shadow-lg`}>
                                    <div className="flex items-center gap-6">
                                        <div className={`w-11 h-11 rounded-2xl ${isDark ? 'bg-black/60 border-white/5 group-hover:text-emerald-400 group-hover:bg-emerald-500/10' : 'bg-white border-slate-200 group-hover:text-purple-500 group-hover:bg-purple-100'} flex items-center justify-center transition-all border`}>
                                            <Usb size={20} />
                                        </div>
                                        <div>
                                            <div className={`text-[11px] font-black ${isDark ? 'group-hover:text-emerald-400' : 'text-slate-700 group-hover:text-purple-600'} transition-colors uppercase tracking-tighter leading-none`}>Endpoint#{i+1}</div>
                                            <div className={`text-[10px] font-mono ${isDark ? 'text-zinc-500' : 'text-slate-400'} mt-2 uppercase tracking-tight opacity-70`}>VID:{p.getInfo().usbVendorId?.toString(16).padStart(4,'0') || '0000'} &nbsp; PID:{p.getInfo().usbProductId?.toString(16).padStart(4,'0') || '0000'}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={20} className={`${isDark ? 'text-zinc-800 group-hover:text-emerald-400' : 'text-slate-300 group-hover:text-purple-500'} transition-all group-hover:translate-x-2`} />
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div className={`p-8 ${isDark ? 'bg-[#0a0a0c] border-white/10' : 'bg-slate-50 border-slate-100'} border-t`}>
                    <button
                      onClick={() => {
                        navigator.serial.requestPort()
                          .then(p => {
                            openPort(p);
                            updatePorts();
                          })
                          .catch(() => {});
                      }}
                      className={`w-full py-5 bg-gradient-to-r ${t.btnPrimary} ${t.btnPrimaryHover} text-white rounded-[1.5rem] text-[11px] font-black tracking-[0.4em] transition-all shadow-2xl ${isDark ? 'shadow-emerald-900/40' : 'shadow-purple-500/30'} flex items-center justify-center gap-4 hover:scale-[1.01] active:scale-98`}
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
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(139, 92, 246, 0.15)'}; border-radius: 10px; border: 1px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: ${isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(139, 92, 246, 0.35)'}; }
      `}</style>
    </div>
  );
}
