import React, { useEffect, useState } from "react";
import { socket } from "./socket";

function getOrCreatePlayerId() {
  let id = localStorage.getItem("playerId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("playerId", id);
  }
  return id;
}

export default function App() {
  const [mode, setMode] = useState("home"); // home | host | player
  const [room, setRoom] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [playerId] = useState(getOrCreatePlayerId());
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [results, setResults] = useState(null);
  const [attackEvent, setAttackEvent] = useState(null);
  const [myPowers, setMyPowers] = useState([]);

  useEffect(() => {
    socket.on("room:update", (roomState) => {
      setRoom(roomState);
    });

    socket.on("room:question:start", (payload) => {
      setCurrentQuestion(payload);
      setResults(null);
    });

    socket.on("room:question:results", (payload) => {
      setResults(payload);
      const mine = payload.playersPowers.find((p) => p.playerId === playerId);
      if (mine) setMyPowers(mine.powers);
    });

    socket.on("room:power:used", (payload) => {
      setAttackEvent(payload);
      setTimeout(() => setAttackEvent(null), 2000);
    });

    socket.on("room:game:ended", ({ leaderboard }) => {
      setResults({ leaderboard, gameEnded: true });
      setCurrentQuestion(null);
    });

    return () => {
      socket.off("room:update");
      socket.off("room:question:start");
      socket.off("room:question:results");
      socket.off("room:power:used");
      socket.off("room:game:ended");
    };
  }, [playerId]);

  const me = room?.players?.find((p) => p.playerId === playerId);

  const handleCreateRoom = () => {
    socket.emit("host:createRoom", ({ roomCode }) => {
      setRoomCode(roomCode);
      setMode("host");
    });
  };

  const handleJoinRoom = (code, name, avatarId, cb) => {
    socket.emit(
      "room:join",
      { roomCode: code, name, avatarId, playerId },
      (res) => {
        if (res.error) cb && cb(res.error);
        else {
          setRoomCode(res.roomCode);
          setMode("player");
          cb && cb(null);
        }
      }
    );
  };

  let content = null;

  if (mode === "home") {
    content = (
      <HomeScreen
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  } else if (mode === "host") {
    content = (
      <HostScreen
        roomCode={roomCode}
        room={room}
        currentQuestion={currentQuestion}
        results={results}
      />
    );
  } else if (mode === "player") {
    content = (
      <PlayerScreen
        roomCode={roomCode}
        room={room}
        playerId={playerId}
        me={me}
        currentQuestion={currentQuestion}
        results={results}
        powers={myPowers}
        attackEvent={attackEvent}
      />
    );
  }

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="top-bar">
          <div className="logo">Anti-Corrupt Quiz</div>
          {roomCode && <div className="tag">ROOM: {roomCode}</div>}
          {me && <div className="tag">คุณ: {me.name} — {me.score} pts</div>}
        </header>
        {content}
      </div>
    </div>
  );
}

function HomeScreen({ onCreateRoom, onJoinRoom }) {
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState("A");
  const [error, setError] = useState("");

  const handleJoinClick = () => {
    if (!joinCode || !name) {
      setError("กรอกรหัสห้องและชื่อก่อน");
      return;
    }
    onJoinRoom(joinCode.toUpperCase(), name, avatarId, (err) => {
      if (err) setError(err);
    });
  };

  return (
    <main className="screen home-screen">
      <section className="card">
        <h1>เกมตอบคำถามต้านการทุจริต</h1>
        <p>สร้างห้องหรือเข้าร่วมห้องเพื่อเริ่มเล่น</p>
        <div className="btn-row">
          <button className="btn primary" onClick={onCreateRoom}>
            สร้างห้อง (Host)
          </button>
        </div>
        <div className="divider">หรือ</div>
        <div className="field">
          <label>รหัสห้อง</label>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            className="input"
            placeholder="เช่น ABCD"
          />
        </div>
        <div className="field">
          <label>ชื่อผู้เล่น</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
        <div className="field">
          <label>ตัวละคร</label>
          <select
            value={avatarId}
            onChange={(e) => setAvatarId(e.target.value)}
            className="input"
          >
            <option value="A">นักเรียนซื่อสัตย์</option>
            <option value="B">ผู้เปิดโปงการโกง</option>
            <option value="C">เยาวชนต้านโกง</option>
          </select>
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn secondary" onClick={handleJoinClick}>
          เข้าร่วมห้อง
        </button>
      </section>
    </main>
  );
}

function HostScreen({ roomCode, room, currentQuestion, results }) {
  const handleStart = () => {
    socket.emit("host:startGame", { roomCode });
  };
  return (
    <main className="screen host-screen">
      <section className="card">
        {!currentQuestion && (!results || results.gameEnded) && (
          <>
            <h2>รอผู้เล่นเข้าร่วม</h2>
            <p>ให้เพื่อนกรอก ROOM CODE: <b>{roomCode}</b></p>
            <button className="btn primary" onClick={handleStart}>
              เริ่มเกม
            </button>
          </>
        )}
        {currentQuestion && (
          <>
            <h2>คำถามข้อที่ {currentQuestion.questionIndex + 1}</h2>
            <p className="q-text">{currentQuestion.question.text}</p>
            <ol className="option-list">
              {currentQuestion.question.options.map((opt, i) => (
                <li key={i}>{opt}</li>
              ))}
            </ol>
          </>
        )}
        {results && (
          <>
            <h3>ผลลัพธ์</h3>
            <Leaderboard data={results.leaderboard} />
            {results.gameEnded && <p>เกมจบแล้ว</p>}
          </>
        )}
      </section>
      <aside className="side card">
        <h3>ผู้เล่นในห้อง</h3>
        <ul className="player-list">
          {room?.players?.map((p) => (
            <li key={p.playerId}>
              <span>{p.name}</span>
              <span>{p.score} pts</span>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

function PlayerScreen({
  roomCode,
  room,
  playerId,
  me,
  currentQuestion,
  results,
  powers,
  attackEvent
}) {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelected(null);
    setError("");
  }, [currentQuestion?.questionIndex]);

  const handleAnswer = (idx) => {
    if (!currentQuestion) return;
    if (selected !== null) return;
    socket.emit(
      "player:submitAnswer",
      { roomCode, playerId, answerIndex: idx },
      (res) => {
        if (res.error) setError(res.error);
        else setSelected(idx);
      }
    );
  };

  const handleUsePower = (powerIndex) => {
    if (!room || !room.players?.length) return;
    const target = window.prompt("ใส่ชื่อผู้เล่นเป้าหมาย (ปล่อยว่างถ้าใช้กับตนเอง)");
    let targetPlayer = me;
    if (target) {
      targetPlayer =
        room.players.find((p) => p.name === target) || me;
    }
    socket.emit(
      "player:usePower",
      {
        roomCode,
        playerId,
        targetPlayerId: targetPlayer.playerId,
        powerIndex
      },
      (res) => {
        if (res.error) alert(res.error);
      }
    );
  };

  return (
    <main className="screen player-screen">
      <section className="card">
        {attackEvent && (
          <div className="attack-overlay">
            <div className="attack-box">
              <div className="attack-beam" />
              <h3>
                {attackEvent.actor.name} ใช้พลัง {attackEvent.powerType} ใส่{" "}
                {attackEvent.target.name}
              </h3>
            </div>
          </div>
        )}
        {!currentQuestion && (!results || results.gameEnded) && (
          <p>รอ Host เริ่มเกม...</p>
        )}
        {currentQuestion && (
          <>
            <h2>ข้อที่ {currentQuestion.questionIndex + 1}</h2>
            <p className="q-text">{currentQuestion.question.text}</p>
            <div className="options-grid">
              {currentQuestion.question.options.map((opt, i) => (
                <button
                  key={i}
                  className={
                    "option-btn" + (selected === i ? " selected" : "")
                  }
                  onClick={() => handleAnswer(i)}
                  disabled={selected !== null}
                >
                  {opt}
                </button>
              ))}
            </div>
            {error && <div className="error-text">{error}</div>}
          </>
        )}
        {results && (
          <>
            <h3>ตารางคะแนน</h3>
            <Leaderboard data={results.leaderboard} />
          </>
        )}
      </section>
      <aside className="side card">
        <h3>พลังที่มี</h3>
        {(!powers || !powers.length) && <p>ยังไม่มีพลังพิเศษ</p>}
        <ul className="power-list">
          {powers?.map((p, idx) => (
            <li key={idx}>
              {p.type} {p.used && "(ใช้แล้ว)"}
              {!p.used && (
                <button
                  className="btn tiny"
                  onClick={() => handleUsePower(idx)}
                >
                  ใช้
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

function Leaderboard({ data }) {
  if (!data) return null;
  return (
    <ul className="leaderboard">
      {data.map((p) => (
        <li key={p.playerId}>
          <span>#{p.rank}</span>
          <span>{p.name}</span>
          <span>{p.score} pts</span>
        </li>
      ))}
    </ul>
  );
}
