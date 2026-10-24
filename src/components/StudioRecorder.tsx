import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export function StudioRecorder() {
  const [open, setOpen] = useState(false);
  const [trackMode, setTrackMode] = useState<"manual" | "file">("manual");
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState("");
  const [duration, setDuration] = useState(15.0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number | null>(null);

  // Toggle via Alt+R, Ctrl+Alt+R, or F9 (safe from browser reload!)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isAltR = e.altKey && (e.key === "R" || e.key === "r" || e.code === "KeyR");
      const isF9 = e.key === "F9" || e.code === "F9";
      if (isAltR || isF9) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    (window as unknown as { toggleRecorder?: () => void }).toggleRecorder = () => setOpen((v) => !v);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      delete (window as unknown as { toggleRecorder?: () => void }).toggleRecorder;
    };
  }, []);

  // Reset playback and status when mode changes
  useEffect(() => {
    stopAudio();
    setRecordedBlob(null);
    setStatusMsg("");
  }, [trackMode]);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlayingAudio(false);
    setProgress(0);
  }

  function getActiveAudioUrl(): string | null {
    if (trackMode === "file") {
      return customAudioUrl;
    }
    return null;
  }

  function onCustomFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    stopAudio();
    if (customAudioUrl) URL.revokeObjectURL(customAudioUrl);
    const url = URL.createObjectURL(f);
    setCustomAudioUrl(url);
    setCustomAudioName(f.name);

    // Read audio length
    const tempAudio = new Audio(url);
    tempAudio.onloadedmetadata = () => {
      if (tempAudio.duration && isFinite(tempAudio.duration)) {
        setDuration(Math.round(tempAudio.duration * 10) / 10);
      }
    };
  }

  function playAudioPreview() {
    if (isPlayingAudio) {
      stopAudio();
      return;
    }
    stopAudio();

    const audioUrl = getActiveAudioUrl();
    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
    setIsPlayingAudio(true);

    const updateProgress = () => {
      if (!audioRef.current) return;
      setProgress(audioRef.current.currentTime);
      if (audioRef.current.ended) {
        setIsPlayingAudio(false);
        setProgress(0);
      } else {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };
    animFrameRef.current = requestAnimationFrame(updateProgress);

    audio.onended = () => {
      setIsPlayingAudio(false);
      setProgress(0);
    };
  }

  async function startRecordingWorkflow() {
    stopAudio();
    setStatusMsg("");

    try {
      // 1. Capture screen or tab
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
          frameRate: 60,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      // 2. Countdown
      for (let c = 3; c > 0; c--) {
        setCountdown(c);
        await new Promise((r) => setTimeout(r, 900));
      }
      setCountdown(null);

      // 3. MediaRecorder
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const mr = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 25_000_000,
      });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const fullBlob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(fullBlob);
        setIsRecording(false);
        setStatusMsg(`Готово: ${(fullBlob.size / 1024 / 1024).toFixed(1)} МБ`);
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start(200);
      setIsRecording(true);

      // 4. Play audio synchronously if available
      const audioUrl = getActiveAudioUrl();
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.play().catch(() => {});
        audio.onended = () => stopRecording();
      }

      const dur = duration;
      const tStart = performance.now();

      const trackProgress = () => {
        const elapsed = (performance.now() - tStart) / 1000;
        setProgress(Math.min(dur, elapsed));

        if (elapsed >= dur) {
          stopRecording();
        } else if (isRecording || mediaRecorderRef.current?.state === "recording") {
          animFrameRef.current = requestAnimationFrame(trackProgress);
        }
      };
      animFrameRef.current = requestAnimationFrame(trackProgress);
    } catch {
      setCountdown(null);
      setIsRecording(false);
      setStatusMsg("Запис скасовано.");
    }
  }

  function stopRecording() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }

  function downloadClip() {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement("a");
    a.href = url;
    const filename = customAudioName ? `${customAudioName.replace(/\.[^/.]+$/, "")}_clip.webm` : "live_recording.webm";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Pointer drag logic for floating window header
  function onDragStart(ev: ReactPointerEvent<HTMLElement>) {
    if ((ev.target as HTMLElement).closest("button")) return;
    const node = panelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function onDragMove(ev: ReactPointerEvent<HTMLElement>) {
    const start = dragRef.current;
    const node = panelRef.current;
    if (!start || !node) return;
    const newLeft = Math.max(10, Math.min(window.innerWidth - 330, start.left + ev.clientX - start.x));
    const newTop = Math.max(10, Math.min(window.innerHeight - 200, start.top + ev.clientY - start.y));
    node.style.left = `${newLeft}px`;
    node.style.top = `${newTop}px`;
    node.style.right = "auto";
  }

  function onDragEnd() {
    dragRef.current = null;
  }

  if (!open) return null;

  // Countdown view
  if (countdown !== null) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          background: "rgba(10, 12, 14, 0.75)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800, color: "#4fc3f7", textShadow: "0 0 32px rgba(79, 195, 247, 0.8)" }}>
          {countdown}
        </div>
        <div style={{ fontSize: 16, color: "#cbd5e1", marginTop: 8 }}>
          Приготуйтесь: початок запису...
        </div>
      </div>
    );
  }

  const pct = Math.min(100, (progress / duration) * 100);

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: 60,
        right: 24,
        width: 320,
        zIndex: 99995,
        background: "#161a22",
        border: "1.5px solid #2a3442",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0,0,0,0.75)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: "#e8eef4",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Draggable Titlebar */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        style={{
          padding: "8px 12px",
          background: "#101214",
          borderBottom: "1px solid #222834",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "grab",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>🎬</span>
          <strong style={{ fontSize: 12, color: "#cbd5e1", letterSpacing: "0.02em" }}>
            Studio Recorder
          </strong>
          {isRecording && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ef5350",
                boxShadow: "0 0 6px #ef5350",
                marginLeft: 4,
              }}
            />
          )}
        </div>
        <button
          onClick={() => {
            stopAudio();
            stopRecording();
            setOpen(false);
          }}
          title="Закрити (Alt+R або F9)"
          style={{
            background: "transparent",
            border: "none",
            color: "#8b98a8",
            fontSize: 14,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px" }}>
        {/* Track Mode Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#101214", padding: 3, borderRadius: 6, marginBottom: 10 }}>
          <button
            onClick={() => setTrackMode("manual")}
            style={{
              flex: 1,
              padding: "4px 0",
              fontSize: 11,
              fontWeight: 600,
              background: trackMode === "manual" ? "#1e293b" : "transparent",
              color: trackMode === "manual" ? "#4fc3f7" : "#8b98a8",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Таймер
          </button>
          <button
            onClick={() => setTrackMode("file")}
            style={{
              flex: 1,
              padding: "4px 0",
              fontSize: 11,
              fontWeight: 600,
              background: trackMode === "file" ? "#1e293b" : "transparent",
              color: trackMode === "file" ? "#4fc3f7" : "#8b98a8",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Свій аудіофайл (.mp3 / .wav)
          </button>
        </div>

        {trackMode === "file" && (
          <div style={{ marginBottom: 10 }}>
            <label
              style={{
                display: "block",
                padding: "6px 8px",
                background: "#101214",
                border: "1px dashed #334155",
                borderRadius: 6,
                fontSize: 11,
                color: customAudioName ? "#4fc3f7" : "#8b98a8",
                textAlign: "center",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {customAudioName ? `🔊 ${customAudioName}` : "+ Обрати аудіофайл (.wav/.mp3)"}
              <input type="file" accept="audio/*" onChange={onCustomFilePicked} style={{ display: "none" }} />
            </label>
          </div>
        )}

        {trackMode === "manual" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "#8b98a8" }}>Тривалість:</span>
            <input
              type="number"
              min="2"
              max="180"
              step="0.5"
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 10))}
              style={{
                width: 70,
                background: "#101214",
                border: "1px solid #2a3442",
                color: "#e8eef4",
                borderRadius: 6,
                padding: "4px 6px",
                fontSize: 12,
                outline: "none",
                textAlign: "center",
              }}
            />
            <span style={{ fontSize: 11, color: "#8b98a8" }}>секунд</span>
          </div>
        )}

        {/* Progress & Timecode */}
        <div style={{ background: "#101214", padding: "8px 10px", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b98a8", marginBottom: 5 }}>
            <span style={{ color: isRecording ? "#ef5350" : isPlayingAudio ? "#4fc3f7" : "#8b98a8", fontWeight: 600 }}>
              {isRecording ? "● ЗАПИС:" : isPlayingAudio ? "▶ ЗВУК:" : "ЧАС:"} {progress.toFixed(1)}s
            </span>
            <span>{duration.toFixed(1)}s</span>
          </div>
          <div style={{ width: "100%", height: 4, background: "#222834", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: isRecording ? "#ef5350" : "#4fc3f7",
                transition: "width 0.1s linear",
              }}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 6 }}>
          {/* Audio Preview Rehearsal */}
          {trackMode !== "manual" && (
            <button
              onClick={playAudioPreview}
              title="Послухати озвучку для репетиції"
              style={{
                flex: 1,
                padding: "6px 8px",
                background: isPlayingAudio ? "#991b1b" : "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                color: "#e8eef4",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <span>{isPlayingAudio ? "⏹" : "▶"}</span>
              <span>{isPlayingAudio ? "Стоп" : "Послухати"}</span>
            </button>
          )}

          {/* Record */}
          <button
            onClick={isRecording ? stopRecording : startRecordingWorkflow}
            style={{
              flex: 1.4,
              padding: "6px 10px",
              background: isRecording ? "#991b1b" : "#0284c7",
              border: `1px solid ${isRecording ? "#ef4444" : "#38bdf8"}`,
              borderRadius: 6,
              color: "#ffffff",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <span>{isRecording ? "⏹" : "●"}</span>
            <span>{isRecording ? "Зупинити" : `Записати (${duration}s)`}</span>
          </button>
        </div>

        {/* Download Clip */}
        {recordedBlob && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={downloadClip}
              style={{
                width: "100%",
                padding: "6px 8px",
                background: "#166534",
                border: "1px solid #22c55e",
                borderRadius: 6,
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <span>💾</span>
              <span>Зберегти відео (.webm)</span>
            </button>
          </div>
        )}

        {statusMsg && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: "#81c784", textAlign: "center" }}>
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}
