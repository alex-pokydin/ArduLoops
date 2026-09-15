/** Ukrainian strings. Keys are the English source phrases. */
export const uk: Record<string, string> = {
  SITL: "SITL",
  Simulation: "симуляція",
  Reset: "скинути",
  "Restore SITL defaults": "Повернути типові SITL",
  "Not SITL — these parameters only exist in simulation.":
    "Це не SITL — таких параметрів на живому борті немає.",
  Wind: "вітер",
  Speedup: "прискорення",
  GPS: "GPS",
  Compass: "компас",
  IMU: "IMU",
  Battery: "батарея",
  Baro: "баро",
  RC: "RC",
  Motors: "мотори",
  speed: "швидкість",
  direction: "напрям",
  turbulence: "турбулентність",
  vertical: "вертикаль",
  settle: "інерція",
  speedup: "прискорення",
  "GPS on": "GPS увімк",
  "GPS fail": "відмова GPS",
  satellites: "супутники",
  lag: "лаг",
  jam: "глушіння",
  "glitch N": "збій N",
  "RC fail": "відмова RC",
  "no RC": "немає RC",
  "thr fail": "газ fail",
  "motor {n}": "мотор {n}",
  "thrust left": "тяги лишилось",
  vibe: "вібрація",
  "motor vibe": "вібро моторів",
  "accel fail": "відмова accel",
  drift: "дрейф",
  noise: "шум",
  delay: "затримка",
  "mag fail": "відмова mag",
  disable: "вимкнути",
  freeze: "заморозка",
  glitch: "збій",
  voltage: "напруга",
  capacity: "ємність",
  on: "on",

  Options: "Опції",
  Close: "Закрити",
  Language: "Мова",
  Init: "Ініт",
  Export: "Експорт",
  "Init · {vehicle}": "Ініт · {vehicle}",
  "Stock SITL dump + lab. Writes the stand — arm-ready.":
    "Сток SITL-дамп + лаба. Запис стенда — готовий до arm.",
  "Write live parameters to a .parm file.":
    "Записати живі параметри у файл .parm.",
  "Write the lab stand dump so a blank SITL can arm.":
    "Залити стендовий дамп, щоб голий SITL можна було армити.",
  "Export current parameters as a .parm file":
    "Експортувати поточні параметри у файл .parm",
  MCP: "MCP",
  Copy: "Копіювати",
  Copied: "Скопійовано",
  "Cursor uses the same MAVLink as this window. Start ArduLoops, then paste the config.":
    "Cursor ходить тим самим MAVLink, що й це вікно. Запустіть ArduLoops, потім вставте конфіг.",
  "Copy Cursor MCP config": "Копіювати MCP-конфіг для Cursor",

  Link: "лінк",
  Stop: "стоп",
  Disconnect: "Від’єднати",
  "Plots paused": "графіки на паузі",
  "Plots running": "графіки далі",
  "Link {url}": "лінк {url}",
  "Link off": "лінк вимкнено",
  "Init · disarm first": "ініт · спочатку disarm",
  "Init · {n} parameters · {vehicle}": "ініт · {n} параметрів · {vehicle}",
  "Init · {n} parameters · {vehicle} · reboot":
    "ініт · {n} параметрів · {vehicle} · ребут",
  "Init · {done}/{total}": "ініт · {done}/{total}",
  "Init · parameters have not arrived yet, wait": "ініт · параметри ще не прийшли, зачекайте",
  "Export · parameters have not arrived yet, wait": "експорт · параметри ще не прийшли, зачекайте",
  "Stand · wrote {n} of {total}": "стандарт · записано {n} з {total}",
  "Axis · {axis}": "вісь · {axis}",
  "Model · 3D": "модель · 3D",
  "Model · one axis": "модель · одна вісь",

  "We want an angle. We don't command the angle — we command the rate that takes us there.":
    "Хочемо кут. Керуємо не кутом, а швидкістю, якою туди крутимось.",
  "The wing cascade is still a stub. RLL_ / PTCH_ / L1 / TECS will appear later.":
    "Каскад крила ще заглушка. RLL_ / PTCH_ / L1 / TECS з’являться пізніше.",
  "Link is up, but attitude is not arriving (ATT 0 Hz). The plot stays flat until SITL sends ATTITUDE.":
    "Лінк є, але кут не надходить (ATT 0 Hz). Графік плоский, поки SITL не надсилає ATTITUDE.",
  "No MAVLink: {detail}. Check the address and the simulation.":
    "Немає MAVLink: {detail}. Перевірте адресу й симуляцію.",
  "SITL not found": "SITL не знайдено",
  View: "вид",
  Plot: "графік",
  Cascade: "каскад",
  Loop: "контур",

  "No link": "Немає лінку",
  Disconnected: "Відключено",
  "Link dropped": "Лінк обірвався",
  "Rebooting…": "Ребут…",
  "No MAVLink ({url})": "Немає MAVLink ({url})",
  "No ATTITUDE, reconnect": "Немає ATTITUDE, reconnect",
  "No HEARTBEAT on {url}. Another GCS may already hold this port.":
    "Немає HEARTBEAT на {url}. Порт уже зайнятий іншим GCS.",

  copter: "коптер",
  plane: "крило",

  roll: "крен",
  pitch: "тангаж",
  yaw: "рискання",
  D: "D",
  height: "висота",
  Height: "Висота",
  Roll: "Крен",
  Pitch: "Тангаж",
  Yaw: "Рискання",
  "Roll rate": "Швидкість крену",
  "Pitch rate": "Швидкість тангажа",
  "Yaw rate": "Швидкість рискання",
  climb: "climb",
  "climb Act": "climb Act",
  "climb target": "ціль climb",
  "altitude target": "ціль висоти",
  AGL: "AGL",
  "m/s": "м/с",
  Axis: "вісь",
  "Model: roll and pitch together": "Модель: крен і тангаж разом",
  "°/s": "°/с",

  Pause: "пауза",
  Resume: "далі",
  Space: "Пробіл",
  now: "зараз",
  "−{n} s": "−{n} с",

  "Where we want to be. Target is heading; actual should catch it. Yaw stick is rate, not angle — that is below.":
    "де хочемо бути. Ціль — курс; факт має її спіймати. Стік рискання — rate, не кут; він унизу.",
  "Heading, not the stick. Error is the shortest turn to the target.":
    "курс, не стік. Помилка — найкоротший поворот до цілі.",
  "Grey is the stick throw, 0 = centered. White and cyan are heading.":
    "сірий — положення стика, 0 = центр. Біла і блакитна — курс.",
  "Where we want to be. Target is not the stick — actual should catch the target.":
    "де хочемо бути. Ціль — не стік; факт має спіймати ціль.",
  Stick: "стик",
  "FC target": "ціль FC",
  "Actual {name}": "{name} Act",
  "actual {ang}°   target {tar}°   stick {cmd}{unit}":
    "факт {ang}°   ціль {tar}°   стик {cmd}{unit}",
  "actual {ang}°   target {tar}°   error {err}°":
    "факт {ang}°   ціль {tar}°   помилка {err}°",
  "actual {ang}°   target {tar}°   stick {cmd}°   error {err}°":
    "факт {ang}°   ціль {tar}°   стик {cmd}°   помилка {err}°",
  "Stick here is rate, not angle. Target is the ATC rate command. In Stabilize the yaw stick goes here.":
    "стік тут — rate, не кут. Ціль — завдання rate від ATC. У Stabilize стік рискання йде сюди.",
  "Amber is the ATC yaw-rate command, cyan is the gyro. Left stick asks for rate — on the ground with throttle down the craft will not yaw.":
    "жовта — завдання yaw-rate від ATC, блакитна — гіроскоп. Лівий стік просить rate; на землі без газу апарат не розвернеться.",
  "How we get there. Rate command is not position — it is “rotate this fast”.":
    "чим туди їдемо. Завдання rate — не позиція, а «крутись ось так швидко».",
  "stick {cmd} °/s": "стик {cmd} °/с",

  "The link is {frame}. The wing cascade map is still a stub — we will build it separately.":
    "Зараз на лінку {frame}. Карта контурів крила ще заглушка — її зберемо окремо.",
  "Here it will not be PSC+ATC, but RLL_* / PTCH_* (angle → rate → servo), with NAVL1_* and TECS_* outside. Yaw defaults to YAW2SRV_*.":
    "Далі тут буде не PSC+ATC, а RLL_* / PTCH_* (кут → rate → серво), зовні NAVL1_* і TECS_*. Yaw за замовчуванням YAW2SRV_*.",

  "On the ground": "на землі",
  "side view": "вид збоку",
  "top view": "вид зверху",
  "rear view": "вид ззаду",
  m: "м",

  "Earth, horizon: North and East. Metres and m/s. Not the nose of the drone.":
    "Земля, горизонт: North і East. Метри і м/с. Не ніс дрона.",
  "D+ is down. Height on the right is AGL, i.e. −D. m, m/s, m/s².":
    "D+ вниз. «Висота» справа — AGL, тобто −D. м, м/с, м/с².",
  "NE acceleration becomes lean — roll and pitch in degrees.":
    "Прискорення NE стає нахилом (lean) — крен і тангаж у градусах.",
  "Body attitude, degrees. Roll / pitch / yaw.":
    "Кут тіла (attitude), градуси. Roll / pitch / yaw.",
  "Body angular rate, °/s. Not airspeed m/s.":
    "Кутова швидкість (rate) тіла, °/с. Не м/с польоту.",
  "Motors: torque from rate and throttle from Down acceleration.":
    "Мотори: момент з кутової швидкості (rate) і газ з прискорення Down.",
  "NED on the earth. Angle and rate live in the drone body.":
    "NED на землі. Кут і кутова швидкість (rate) — у тілі дрона.",
  "top · NE": "згори · NE",
  "side · D+": "збоку · D+",
  "rear · body": "ззаду · тіло",
  "m · m/s": "м · м/с",
  "m · m/s · m/s²": "м · м/с · м/с²",
  "roll · pitch · yaw": "крен · тангаж · yaw",

  "Preset sets P I D. Throttle is left stick, roll is right.":
    "Пресет ставить P I D. Газ — лівий стик, крен — правий.",
  "No link · {detail}": "немає лінку · {detail}",
  "On the ground · AGL < 2 m, sticks barely rotate the craft":
    "на землі · AGL < 2 м, стики майже не крутять",
  Airborne: "у повітрі",
  "SITL is sitting. Raise throttle — otherwise the stick will not move the craft.":
    "SITL лежить. Підніміть газ — інакше стик не зрушить апарат.",
  Wool: "вата",
  Sharp: "гостро",
  "Harsh / ringing": "різкість / дзвін",
  Stock: "сток",
  Maneuver: "маневр",
  "Act lags Tar. P and I are small: there is error, little rate.":
    "Act відстає від Tar. P і I малі: помилка є, швидкості мало.",
  "Yaw P is small. Left stick — a slow turn.":
    "P рискання малий. Лівий стик — повільний розворот.",
  "P×0.2 and I are cut. Quiet in hover; {stick} stick — slow return (wool).":
    "P×0.2 і I зрізані. На висінні тихо; {stick} стиком — повільне повернення (вата).",
  "Act chases Tar. P is large — expect overshoot or ringing.":
    "Act ганяється за Tar. P великий — очікуйте переліт або дзвін.",
  "P is high. {Stick} stick will show overshoot or ringing.":
    "P завищений. {Stick} стиком покаже переліт або дзвін.",
  "Yaw stick is rate. Watch whether amber and cyan match on the lower plot.":
    "Стік рискання — це rate. Дивіться, чи жовта і синя на нижньому графіку збігаються.",
  "Watch whether cyan meets white after you release the stick.":
    "Дивіться, чи збігається блакитна лінія з білою після відпускання стика.",
  "Yaw is separate: I is smaller, D is often 0. Left stick is the reference — does rate catch the command.":
    "Yaw окремо: I менший, D часто 0. Лівий стік — еталон, чи rate ловить завдання.",
  "Typical P. {Stick} stick is the horizon-return reference.":
    "Типове P. {Stick} стиком — еталон повернення на горизонт.",
  "AGL height": "висота AGL",
  "takeoff ↑ {v} m/s": "зліт ↑ {v} м/с",
  Sitting: "лежить",
  "↑ {v} m/s": "↑ {v} м/с",
  "↓ {v} m/s": "↓ {v} м/с",
  Holding: "тримає",
  "Flight mode": "Режим польоту",
  Mode: "режим",
  "Mode {mode}": "режим {mode}",
  "Virtual Mode 2 sticks": "віртуальні стики Mode 2",
  "Left stick: yaw (left-right)": "Лівий стик: рискання (ліво-право)",
  "Left stick: throttle and yaw": "Лівий стик: газ і рискання",
  "Right stick: roll and pitch": "Правий стик: крен і тангаж",
  "Right stick: pitch (up-down)": "Правий стик: тангаж (вгору-вниз)",
  "Right stick: roll (left-right)": "Правий стик: крен (ліво-право)",
  Thr: "газ",
  "Thr−": "газ−",
  "Yaw−": "риск−",
  "Yaw+": "риск+",
  "Roll−": "крен−",
  "Roll+": "крен+",
  Log: "журнал",
  "No gains. Pick a regulator — sliders stay here and on the plot.":
    "Немає гейнів. Виберіть регулятор — слайдери залишаться тут і на графіку.",
  "Wool · P {p} I {i} D {d}": "вата · P {p} I {i} D {d}",
  "Stock · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}":
    "сток · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}",
  "Sharp · P {p} I {i} D {d}": "гостро · P {p} I {i} D {d}",
  "arm · {mode}": "arm · {mode}",
  off: "off",

  "lean angle": "нахил (lean)",
  "accel NE": "accel NE",
  "desired roll/pitch": "desired roll/pitch",
  "desired ad": "desired ad",
  "tar rate": "tar rate",
  "rate Act": "rate Act",
  "Pilot stick": "стік пілота",
  Navigation: "навігація",
  "NE position": "позиція NE",
  "D position": "позиція D",
  "NE velocity": "швидкість NE",
  "D velocity": "швидкість D",
  "D acceleration": "прискорення D",
  "angle → rate": "кут → rate",
  "rate → torque": "rate → момент",
  command: "команда",
  "targets, not PID": "цілі, не PID",
  "not PID": "не PID",
  stick: "стік",
  "m · NED": "м · NED",
  "m · NED NE": "м · NED NE",
  "m · NED D+": "м · NED D+",
  "m/s · NED NE": "м/с · NED NE",
  "m/s · NED D+": "м/с · NED D+",
  "° · roll/pitch": "° · крен/тангаж",
  "m/s² · throttle": "м/с² · газ",
  "° · body": "° · тіло",
  "°/s · body": "°/с · тіло",
  "torque + throttle": "момент + газ",
  "accel → roll/pitch": "accel → крен/тангаж",
  typical: "типово",
  "Not a loop — the stick request. Stabilize wants an angle, AltHold a climb rate (PILOT_SPD_UP / DN), Loiter a lean/accel, Acro a rate. TC / ACC / Rmax only shape how fast that request may change (Input Shaping).":
    "Не контур — запит зі стика. Stabilize хоче кут, AltHold — climb (PILOT_SPD_UP / DN), Loiter — lean/accel, Acro — rate. TC / ACC / Rmax лише обмежують, як швидко цей запит може змінюватись (Input Shaping).",
  "Do not raise ACC or Rmax past Autotune to “get more P”. That is feel, not stability. If AltHold creeps, hover is not mid-stick — set MOT_THST_HOVER, do not touch PSC yet.":
    "Не піднімай ACC чи Rmax вище Autotune, щоб «було більше P». Це відчуття, не стабільність. Якщо AltHold повзе — ховер не на середині стика: став MOT_THST_HOVER, не чіпай PSC.",
  "Writes a place for PSC to hold, plus how fast to get there. WP_SPD is mission cruise; LOIT_SPEED_MS is stick speed in Loiter. Not a PID.":
    "Пише місце, яке PSC має тримати, і як швидко туди летіти. WP_SPD — круїз місії; LOIT_SPEED_MS — швидкість зі стика в Loiter. Не PID.",
  "Drifting in Loiter is GPS, compass, vibe or PSC. These speeds only cap how fast it flies the path — raising them will not hold position.":
    "Дрейф у Loiter — GPS, компас, вібрації або PSC. Ці швидкості лише обмежують, як швидко летить шлях — підняти їх не утримає позицію.",
  "Holds North–East in metres: position error → desired horizontal speed. P only.":
    "Тримає North–East у метрах: помилка позиції → бажана горизонтальна швидкість. Лише P.",
  "Leave stock until attitude is tuned. Raising P will not fix a bad rate loop or a bad mag.":
    "Залиш сток, доки не налаштований attitude. Підняти P не виправить слабкий rate чи поганий маг.",
  "Holds height: AGL error (−D) → desired climb. P only. D+ is down.":
    "Тримає висоту: помилка AGL (−D) → бажаний climb. Лише P. D+ вниз.",
  "Too much P → jerky throttle. Switching into AltHold while climbing makes motors dip, then catch — enter while level.":
    "Занадто високий P → рваний газ. Вхід в AltHold під час набору садить мотори, потім ловить — заходь рівно.",
  "Turns “go there” into a lean request: speed error → desired NE acceleration. There is no separate horizontal accel PID.":
    "Перетворює «лети туди» на запит lean: помилка швидкості → бажане прискорення NE. Окремого горизонтального accel PID немає.",
  "If Loiter weaves after a good ATC tune, look here — not at Navigation. Too much D twitches the lean.":
    "Якщо Loiter плететься після нормального ATC — дивись сюди, не в Navigation. Занадто багато D смикає lean.",
  "Turns the climb command into vertical acceleration. Usually left at defaults.":
    "Перетворює команду climb на вертикальне прискорення. Зазвичай лишають сток.",
  "Do not chase bounce on this P. Check vibe and PSC_D_ACC I (keep P:I ≈ 1:2) first.":
    "Не ганяй підскоки цим P. Спочатку вібрації і PSC_D_ACC I (тримай P:I ≈ 1:2).",
  "Geometry, not a loop: NE acceleration (earth, m/s²) becomes roll/pitch (body, °). ATC_ANGLE_MAX is the lean ceiling.":
    "Геометрія, не контур: прискорення NE (земля, м/с²) стає креном/тангажем (тіло, °). ATC_ANGLE_MAX — стеля нахилу.",
  "Not Loiter speed — that is LOIT_SPEED_MS on Navigation. Raising ANGLE_MAX only lets it tilt more. Wrong lean still usually means velocity PID or ATC.":
    "Це не Loiter speed — він на Navigation (LOIT_SPEED_MS). Підняти ANGLE_MAX лише дозволяє сильніше нахилятись. Кривий lean усе одно частіше velocity PID або ATC.",
  "Throttle from vertical accel error. Skips the angle loop — motors get force, not a tilt.":
    "Газ з помилки вертикального accel. Минає контур кута — мотори отримують силу, не нахил.",
  "Never raise P/I; powerful frames may cut both ~50%. Keep I ≈ 2×P. I = 0 fails pre-arm. High vibe → runaway climb in AltHold.":
    "Ніколи не піднімай P/I; потужні рами можуть обрізати обидва ~50%. Тримай I ≈ 2×P. I = 0 валить pre-arm. Сильні вібрації → розгін вгору в AltHold.",
  "Angle error → how fast to rotate (rate command). P only. Motors cannot “be 10°”.":
    "Помилка кута → як швидко крутитись (команда rate). Лише P. Мотори не вміють «бути 10°».",
  "High P → oscillate; low P → sluggish. Do not crank ANG P to hide a weak rate tune. Autotune sets this after rate.":
    "Високий P → осциляція; низький → мляво. Не крути ANG P, щоб сховати слабкий rate. Autotune ставить це після rate.",
  "The loop you actually fly: °/s error → mixer torque. Rate P is the first parameter that matters.":
    "Контур, яким реально літаєш: помилка °/с → момент у мікшер. Rate P — перший параметр, що має значення.",
  "Tune in Stabilize before Autotune. Oscillation → lower P/D, not more I. Fix gyro notch/vibe before chasing D. Yaw is separate (small I, D often 0).":
    "Налаштовуй у Stabilize до Autotune. Осциляція → знижуй P/D, не досипай I. Спершу notch/вібрації гіро, потім D. Yaw окремо (малий I, D часто 0).",
  "Mixer: rate torque plus D-accel throttle. Not a PID.":
    "Мікшер: момент з rate плюс газ з D-accel. Не PID.",
  "Hover should sit near mid stick (~50%). That is MOT_THST_HOVER below. Above ~70% the frame is underpowered — motors/props, not PIDs.":
    "Ховер має бути біля середини стика (~50%). Це MOT_THST_HOVER нижче. Вище ~70% рама слабка — мотори/пропи, не PID.",

  "want · angle, °": "хочемо · кут, °",
  "want · height, m": "хочемо · висота, м",
  "command · rate, °/s": "керуємо · rate, °/с",
  "command · climb, m/s": "керуємо · climb, м/с",
  "White is the altitude target, cyan is AGL (−D). Throttle stick is on the readout — 0 = mid.":
    "біла — ціль висоти, блакитна — AGL (−D). Стік газу в рядку цифр, 0 = середина.",
  "AGL {ang} m   target {tar} m   throttle {cmd}%   error {err} m":
    "AGL {ang} м   ціль {tar} м   газ {cmd}%   помилка {err} м",
  "Amber is the throttle climb command (PILOT_SPD_UP), cyan is climb. Up is +.":
    "жовта — завдання climb зі стика газу (PILOT_SPD_UP), блакитна — climb. Вгору це +.",
  "tar climb": "tar climb",
  "climb {v} m/s   tar {tar} m/s": "climb {v} м/с   tar {tar} м/с",
  "climb {v} m/s": "climb {v} м/с",
  "{v} m/s": "{v} м/с",
  "{v}%": "{v}%",
  "Left stick: throttle (up-down)": "Лівий стик: газ (вгору-вниз)",
  "side view · height": "збоку · висота",
  Climb: "набір",
  "Throttle stick is climb. Amber on the lower plot should meet cyan.":
    "стік газу — це climb. Жовта на нижньому графіку має збігтися з блакитною.",
  "D+ is down. Height is AGL (−D). Left stick up/down is throttle.":
    "D+ вниз. Висота — AGL (−D). Лівий стик вгору-вниз — газ.",
  "want angle": "хочу кут",
  "stick = lean/accel": "стік = lean/accel",
  "stick = climb": "стік = climb",
  "stick = rate": "стік = rate",
  "XY target": "ціль XY",
  "D target": "ціль D",
  "desired Vxy": "бажана Vxy",
  "desired Vd": "бажаний Vd",
  throttle: "газ",
  torque: "момент",
  "not a regulator": "не регулятор",
  tune: "настройка",
  "tune · manuals": "настройка · мануал",
  sometimes: "іноді",
  "sometimes · Loiter": "іноді · Loiter",
  "The manuals tune attitude first: rate (Manual / QuikTune / AutoTune), then angle P, then stick feel (Input Shaping). PSC position loops are usually left at defaults.":
    "За мануалом спочатку attitude: rate (Manual / QuikTune / AutoTune), далі angle P, потім відчуття стика (Input Shaping). Контури PSC зазвичай лишають стоком.",
  "Autotune writes the same rate and angle blocks, from AltHold. If Loiter still weaves after that, NE velocity is the next knob — not Navigation.":
    "Autotune пише ті самі блоки rate і angle, з AltHold. Якщо Loiter після цього ще плететься — наступний важіль швидкість NE, не Navigation.",
  outer: "зовнішній",
  inner: "внутрішній",
  position: "позиція",
  velocity: "швидкість",
  acceleration: "прискорення",
  angle: "кут",
  actuator: "актуатор",
  "boundary · lean becomes desired angle": "межа · lean стає бажаним кутом",
  "stick {v}{unit}": "стик {v}{unit}",
  "target {v}°": "ціль {v}°",
  "{name} {v}°": "{name} {v}°",
  "tar {v}°/s": "tar {v}°/с",
  "rate {v}°/s": "rate {v}°/с",
  "AGL {v} m": "AGL {v} м",
  "{v}{unit}": "{v}{unit}",
  rate: "rate",
  P: "P",
  "P only": "лише P",
  AC_PID: "AC_PID",
  AC_PID_2D: "AC_PID_2D",
  AC_PID_Basic: "AC_PID_Basic",
  "PWM / DShot": "PWM / DShot",
  "{v} °/s": "{v} °/с",
  "{v} m": "{v} м",
  "Why the loops are separate": "Чому контури окремі",
  "all loops": "усі контури",
  "In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.":
    "У {mode} цей контур не працює: автопілот його зараз не крутить. Гейни можна дивитись, але на поведінку вони не вплинуть, поки режим його не замкне.",
  In: "Входить",
  Out: "Віддає",
  "Stock Copter cascade: PosControl (PSC, outer) holds where to be, Attitude Control (ATC, inner) holds the angle.":
    "Штатний каскад Copter: PosControl (PSC, зовнішній) тримає де бути, Attitude Control (ATC, внутрішній) тримає кут.",
  "Motors cannot “turn to 10°” — only thrust. Thrust difference makes torque. So the attitude regulator (ATC_ANG) does not spin motors: from angle error it computes how fast to rotate toward the target and sets a rate command for the next loop. The rate regulator does that job: °/s error → mixer torque.":
    "Мотори не вміють «повернутись на 10°» — лише тяга. Різниця тяг дає момент (torque). Тому регулятор кута (attitude, ATC_ANG) не крутить мотори: з помилки кута він рахує, як швидко треба крутитись до цілі, і ставить завдання кутової швидкості (rate, ATC_RAT) наступному контуру. Регулятор rate це завдання виконує: помилка °/с → момент у мікшер.",
  "The boundary is lean: horizontal acceleration becomes desired roll and pitch. Then ATC works in the body (° and °/s). Vertical skips angle: Down acceleration (PSC_D_ACC) goes straight to throttle. Yaw is the same two inner loops: angle and rate.":
    "Межа між ними — нахил (lean): горизонтальне прискорення стає бажаним креном і тангажем. Далі ATC працює в тілі (° і °/с). Вертикаль кут обходить: прискорення Down (accel, PSC_D_ACC) одразу йде в газ. Рискання (yaw) — ті самі два внутрішні контури: кут і кутова швидкість.",
  "There is no separate horizontal-acceleration PID. WP, Loiter and Circle set targets; they are not regulators. Not shown: Plane, CC2_, FHLD, FOLL, heli.":
    "Окремого PID горизонтального прискорення немає. WP, Loiter і Circle задають цілі, це не регулятори. Не показано: Plane, CC2_, FHLD, FOLL, heli.",
  "In {mode}, inactive blocks are not closed now.":
    "У {mode} неактивні блоки зараз не замкнені.",
  "All stock-cascade loops are visible now.": "Зараз видно всі контури штатного каскаду.",
  "this mode": "цьому режимі",

  "A loop because the output is compared to the command again.":
    "Контур тому, що вихід знову порівнюють із завданням.",
  "This block is not a PID. Below is a closed regulator loop (the same one on the map with P / I / D). Pick angle → rate or rate → torque to see live numbers.":
    "Цей блок не PID. Нижче — як виглядає замкнений контур регулятора (той самий, що на карті з літерами P / I / D). Виберіть кут → rate або rate → момент, щоб побачити живі числа.",
  "Closed PID loop": "Замкнений контур PID",
  "feedback — that is why it is a loop": "зворотний звʼязок (feedback) — тому це loop",
  feedback: "зворотний звʼязок",
  want: "хочемо",
  error: "помилка",
  plant: "обʼєкт",
  "plant · motors / body": "plant · мотори / тіло",
  actual: "факт",
  none: "немає",
  "rate command": "завдання rate",
  "actual rate": "факт rate",
  "angle target": "ціль кута",
  "desired rate": "бажаний rate",
  setpoint: "завдання",
  output: "вихід",
  "(−1…+1 mixer)": "(−1…+1 мікшер)",
  "now {v}{mix}": "зараз {v}{mix}",
  "stick on the plot": "стік на графіку",
  "This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.":
    "Це спрощення AC_PID / AC_P. У прошивці ще фільтри цілі й D (FLTT / FLTE / FLTD), стеля інтегратора IMAX і обмеження slew (SMAX). На крилі додається FF · r.",
  extend: "ширше",
  "AC_PID filters are the dashed boxes. Gyro notch is on the cyan return (IMU), before the rate the PID subtracts. FREQ from hover FFT — not a feel slider.":
    "Пунктир — фільтри AC_PID. Виріз гіроскопа на ціановому поверненні (IMU), до rate, який PID віднімає. FREQ з FFT у зависанні — не слайдер «на відчуття».",
  "This stage is P only. Gyro notch is still on the IMU return.":
    "Тут лише P. Виріз гіроскопа все одно на поверненні IMU.",
  "gyro notch": "виріз гіро",
  "gyro IMU": "гіро IMU",
  PID: "ПІД",
};
