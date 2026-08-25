const audio = document.getElementById("audio");
const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");
const progress = document.getElementById("progress");
const currentTimeEl = document.getElementById("currentTime");
const totalTimeEl = document.getElementById("totalTime");
const titleEl = document.getElementById("title");
const songListEl = document.getElementById("songList");
const shuffleIcon = document.getElementById("shuffleIcon");
const searchInput = document.getElementById("searchInput");

let songs = [];
let currentIndex = 0;
let isShuffling = false;
let restoringFromLocal = true;

/* =========================================================
   PLAYER PERFORMANCE / NETWORK SETTINGS
   ========================================================= */

// Keep more audio buffered when possible.
// Browser/server decide the actual buffer amount.
audio.preload = "auto";

// Prevent unnecessary automatic download before playback
// can be changed to "metadata" if you want maximum data saving.
// "auto" gives smoother playback on normal networks.
audio.preload = "auto";

// Remember whether the user intentionally paused.
let userPaused = false;

// Prevent multiple recovery attempts at the same time.
let isRecovering = false;

// Network recovery timer.
let recoveryTimer = null;

// Number of recovery attempts.
let recoveryAttempts = 0;

// Maximum automatic recovery attempts.
const MAX_RECOVERY_ATTEMPTS = 5;

// Save position less frequently.
let lastPositionSave = 0;


/* =========================================================
   SONG JSON CACHE
   ========================================================= */

const SONGS_CACHE_KEY = "musicJsonCache";
const SONGS_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes


/* =========================================================
   LOAD SONGS
   ========================================================= */

async function loadSongs() {

  titleEl.textContent = "Loading songs...";

  try {

    let data;

    /*
     * Try localStorage cache first.
     * This prevents music.json from being downloaded
     * repeatedly.
     */

    const cached = localStorage.getItem(SONGS_CACHE_KEY);

    if (cached) {

      try {

        const parsed = JSON.parse(cached);

        if (
          parsed.ts &&
          Date.now() - parsed.ts < SONGS_CACHE_TTL_MS
        ) {

          data = parsed.data;

        }

      } catch (_) {

        // Ignore corrupt cache

      }

    }


    /*
     * Download music.json only when cache is unavailable.
     */

    if (!data) {

      const res = await fetch("music.json", {
        cache: "no-cache"
      });

      if (!res.ok) {
        throw new Error("Unable to load music.json");
      }

      data = await res.json();

      try {

        localStorage.setItem(
          SONGS_CACHE_KEY,
          JSON.stringify({
            ts: Date.now(),
            data
          })
        );

      } catch (_) {

        // Storage unavailable/full.
      }

    }


    /*
     * Convert plain filenames to objects.
     */

    songs = data.map(file => ({

      file,

      title: file.replace(".mp3", ""),

      album: "My Playlist",

      artist: "Unknown Artist",

      artwork: "images/music.png"

    }));


    if (!songs.length) {

      titleEl.textContent = "No songs found.";

      return;

    }


    /*
     * Restore previous song.
     */

    const savedIndex = parseInt(
      localStorage.getItem("lastIndex")
    );

    const savedTime = parseFloat(
      localStorage.getItem("lastTime")
    );


    currentIndex =
      !isNaN(savedIndex) &&
      savedIndex >= 0 &&
      savedIndex < songs.length
        ? savedIndex
        : 0;


    loadSong(currentIndex);


    /*
     * Restore previous position.
     */

    if (!isNaN(savedTime) && savedTime >= 0) {

      const restorePosition = () => {

        if (
          restoringFromLocal &&
          isFinite(audio.duration) &&
          savedTime < audio.duration
        ) {

          try {

            audio.currentTime = savedTime;

          } catch (_) {}

          restoringFromLocal = false;

        }

      };


      if (audio.readyState >= 1) {

        restorePosition();

      } else {

        audio.addEventListener(
          "loadedmetadata",
          restorePosition,
          { once: true }
        );

      }

    }


    renderSongList();

    startTypingSuggestions();

  } catch (err) {

    titleEl.textContent = "Error loading songs.";

    console.error(err);

  }

}


/* =========================================================
   LOAD SONG
   ========================================================= */

function loadSong(index, fromClick = false) {

  const song = songs[index];

  if (!song) return;


  /*
   * Stop old recovery timers.
   */

  clearTimeout(recoveryTimer);

  isRecovering = false;

  recoveryAttempts = 0;


  /*
   * Reset audio state.
   */

  audio.pause();


  /*
   * IMPORTANT:
   * Your existing folder structure is unchanged.
   *
   * songs/
   *    song.mp3
   */

  audio.src = `songs/${song.file}`;

  audio.load();


  titleEl.textContent = song.title;


  const cover = document.getElementById("cover");

  if (cover) {

    cover.src = song.artwork;

  }


  if (fromClick) {

    restoringFromLocal = false;

    /*
     * currentTime is set after metadata loads.
     * This avoids errors on some browsers.
     */

    audio.addEventListener(
      "loadedmetadata",
      () => {

        try {

          audio.currentTime = 0;

        } catch (_) {}

      },
      { once: true }
    );

  }


  highlightSong();

  updateMediaSession(song);

}


/* =========================================================
   MEDIA SESSION
   Android / iOS / LOCK SCREEN / HEADPHONES
   ========================================================= */

function updateMediaSession(song) {

  if (!("mediaSession" in navigator)) return;


  try {

    navigator.mediaSession.metadata =
      new MediaMetadata({

        title: song.title,

        artist: song.artist || "Unknown Artist",

        album: song.album || "My Playlist",

        artwork: [

          {
            src: "images/Music_square.png",
            sizes: "512x512",
            type: "image/png"
          }

        ]

      });


    /*
     * Play
     */

    navigator.mediaSession.setActionHandler(
      "play",
      () => {

        userPaused = false;

        audio.play().catch(() => {});

      }
    );


    /*
     * Pause
     */

    navigator.mediaSession.setActionHandler(
      "pause",
      () => {

        userPaused = true;

        audio.pause();

      }
    );


    /*
     * Previous
     */

    navigator.mediaSession.setActionHandler(
      "previoustrack",
      prevSong
    );


    /*
     * Next
     */

    navigator.mediaSession.setActionHandler(
      "nexttrack",
      nextSong
    );


    /*
     * Seek backward 10 seconds
     */

    navigator.mediaSession.setActionHandler(
      "seekbackward",
      () => {

        audio.currentTime =
          Math.max(
            0,
            audio.currentTime - 10
          );

      }
    );


    /*
     * Seek forward 10 seconds
     */

    navigator.mediaSession.setActionHandler(
      "seekforward",
      () => {

        audio.currentTime =
          Math.min(
            audio.duration || Infinity,
            audio.currentTime + 10
          );

      }
    );


    /*
     * Seek to position
     */

    navigator.mediaSession.setActionHandler(
      "seekto",
      details => {

        if (!isFinite(audio.duration)) return;

        if (
          details.fastSeek &&
          "fastSeek" in audio
        ) {

          audio.fastSeek(
            details.seekTime
          );

        } else {

          audio.currentTime =
            details.seekTime;

        }

      }
    );


  } catch (err) {

    console.warn(
      "MediaSession action not supported:",
      err
    );

  }

}


/* =========================================================
   PLAY / PAUSE
   ========================================================= */

function playPause() {

  if (audio.paused) {

    userPaused = false;

    audio.play().catch(err => {

      console.warn(
        "Playback could not start:",
        err
      );

    });

  } else {

    userPaused = true;

    audio.pause();

  }

}


/* =========================================================
   PREVIOUS SONG
   ========================================================= */

function prevSong() {

  if (!songs.length) return;

  currentIndex =
    (currentIndex - 1 + songs.length) %
    songs.length;

  restoringFromLocal = false;

  loadSong(currentIndex);

  userPaused = false;

  audio.play().catch(() => {});

}


/* =========================================================
   NEXT SONG
   ========================================================= */

function nextSong() {

  if (!songs.length) return;


  if (isShuffling) {

    if (songs.length === 1) {

      currentIndex = 0;

    } else {

      let next;

      do {

        next =
          Math.floor(
            Math.random() * songs.length
          );

      } while (
        next === currentIndex
      );

      currentIndex = next;

    }

  } else {

    currentIndex =
      (currentIndex + 1) %
      songs.length;

  }


  restoringFromLocal = false;

  loadSong(currentIndex);

  userPaused = false;

  audio.play().catch(() => {});

}


/* =========================================================
   SHUFFLE
   ========================================================= */

function toggleShuffle() {

  isShuffling = !isShuffling;

  shuffleIcon.classList.toggle(
    "text-green-400",
    isShuffling
  );

}


/* =========================================================
   HIGHLIGHT CURRENT SONG
   ========================================================= */

function highlightSong() {

  /*
   * This keeps your existing behavior.
   */

  [...songListEl.children].forEach(
    (li, i) => {

      li.classList.toggle(
        "bg-indigo-800",
        i === currentIndex
      );

    }
  );

}


/* =========================================================
   RENDER SONG LIST
   ========================================================= */

function renderSongList(filtered = songs) {

  songListEl.innerHTML = "";

  const frag =
    document.createDocumentFragment();


  filtered.forEach(song => {

    const li =
      document.createElement("li");


    li.className =
      "px-4 py-2 cursor-pointer hover:bg-indigo-700 rounded-md";


    li.textContent =
      song.title;


    li.onclick = () => {

      currentIndex =
        songs.indexOf(song);

      loadSong(
        currentIndex,
        true
      );

      userPaused = false;

      audio.play().catch(() => {});

    };


    frag.appendChild(li);

  });


  songListEl.appendChild(frag);

  highlightSong();

}


/* =========================================================
   SORT
   ========================================================= */

function sortSongs() {

  songs.sort(
    (a, b) =>
      a.title.localeCompare(
        b.title
      )
  );

  renderSongList();

}


/* =========================================================
   SEARCH
   ========================================================= */

function filterSongs() {

  const keyword =
    searchInput.value.toLowerCase();


  const filtered =
    songs.filter(song =>
      song.title
        .toLowerCase()
        .includes(keyword)
    );


  renderSongList(filtered);

}


/* =========================================================
   FORMAT TIME
   ========================================================= */

function formatTime(sec) {

  if (!isFinite(sec)) {

    return "0:00";

  }


  const m =
    Math.floor(sec / 60);


  const s =
    Math.floor(sec % 60)
      .toString()
      .padStart(2, "0");


  return `${m}:${s}`;

}


/* =========================================================
   TIME UPDATE
   ========================================================= */

audio.addEventListener(
  "timeupdate",
  () => {

    if (!isFinite(audio.duration)) {
      return;
    }


    const percent =
      (audio.currentTime /
        audio.duration) * 100;


    progress.value =
      percent || 0;


    currentTimeEl.textContent =
      formatTime(
        audio.currentTime
      );


    totalTimeEl.textContent =
      formatTime(
        audio.duration
      );


    /*
     * Save playback position every 2 seconds.
     */

    const now = Date.now();


    if (
      now - lastPositionSave >
      2000
    ) {

      try {

        localStorage.setItem(
          "lastIndex",
          currentIndex
        );

        localStorage.setItem(
          "lastTime",
          audio.currentTime
        );

      } catch (_) {}


      lastPositionSave = now;

    }

  }
);


/* =========================================================
   PROGRESS BAR
   ========================================================= */

progress.addEventListener(
  "input",
  () => {

    if (!isFinite(audio.duration)) {
      return;
    }


    audio.currentTime =
      (progress.value / 100) *
      audio.duration;

  }
);


/* =========================================================
   SONG ENDED
   ========================================================= */

audio.addEventListener(
  "ended",
  () => {

    recoveryAttempts = 0;

    nextSong();

  }
);


/* =========================================================
   PLAY
   ========================================================= */

audio.addEventListener(
  "play",
  () => {

    userPaused = false;

    playIcon.classList.add(
      "hidden"
    );

    pauseIcon.classList.remove(
      "hidden"
    );


    recoveryAttempts = 0;

  }
);


/* =========================================================
   PAUSE
   ========================================================= */

audio.addEventListener(
  "pause",
  () => {

    playIcon.classList.remove(
      "hidden"
    );

    pauseIcon.classList.add(
      "hidden"
    );


    /*
     * Save immediately.
     */

    try {

      localStorage.setItem(
        "lastIndex",
        currentIndex
      );

      localStorage.setItem(
        "lastTime",
        audio.currentTime
      );

    } catch (_) {}

  }
);


/* =========================================================
   BUFFERING / WAITING
   ========================================================= */

audio.addEventListener(
  "waiting",
  () => {

    /*
     * The network is temporarily slow.
     *
     * Do NOT change song.
     * Do NOT reload immediately.
     *
     * Let the browser buffer.
     */

    console.log(
      "Buffering audio..."
    );

  }
);


/* =========================================================
   CAN PLAY
   ========================================================= */

audio.addEventListener(
  "canplay",
  () => {

    console.log(
      "Audio buffer ready."
    );

  }
);


/* =========================================================
   STALLED
   ========================================================= */

audio.addEventListener(
  "stalled",
  () => {

    console.warn(
      "Network stalled. Waiting for recovery..."
    );

    recoverPlayback();

  }
);


/* =========================================================
   NETWORK ERROR
   ========================================================= */

audio.addEventListener(
  "error",
  () => {

    if (userPaused) {
      return;
    }

    console.warn(
      "Audio error. Attempting recovery..."
    );

    recoverPlayback();

  }
);


/* =========================================================
   NETWORK RECOVERY
   ========================================================= */

function recoverPlayback() {

  if (isRecovering) {
    return;
  }


  if (userPaused) {
    return;
  }


  if (
    recoveryAttempts >=
    MAX_RECOVERY_ATTEMPTS
  ) {

    console.warn(
      "Maximum recovery attempts reached."
    );

    return;

  }


  isRecovering = true;

  recoveryAttempts++;


  /*
   * Exponential retry:
   *
   * 1 sec
   * 2 sec
   * 4 sec
   * 8 sec
   * 16 sec
   */

  const delay =
    Math.min(
      16000,
      1000 *
      Math.pow(
        2,
        recoveryAttempts - 1
      )
    );


  console.log(
    `Retrying playback in ${delay}ms`
  );


  clearTimeout(recoveryTimer);


  recoveryTimer =
    setTimeout(() => {

      /*
       * Remember current position.
       */

      const position =
        audio.currentTime;


      const wasPlaying =
        !audio.paused;


      try {

        /*
         * Reload the same song.
         */

        audio.load();


        audio.addEventListener(
          "loadedmetadata",
          () => {

            try {

              if (
                isFinite(position) &&
                position < audio.duration
              ) {

                audio.currentTime =
                  position;

              }

            } catch (_) {}

          },
          { once: true }
        );


        if (wasPlaying) {

          audio.play()
            .then(() => {

              isRecovering = false;

            })
            .catch(() => {

              isRecovering = false;

              recoverPlayback();

            });

        } else {

          isRecovering = false;

        }

      } catch (err) {

        console.error(
          "Playback recovery failed:",
          err
        );

        isRecovering = false;

      }

    }, delay);

}


/* =========================================================
   ONLINE / OFFLINE DETECTION
   ========================================================= */

window.addEventListener(
  "offline",
  () => {

    console.warn(
      "Internet connection lost."
    );

  }
);


window.addEventListener(
  "online",
  () => {

    console.log(
      "Internet connection restored."
    );


    if (
      !audio.paused &&
      audio.readyState < 3
    ) {

      recoverPlayback();

    }

  }
);


/* =========================================================
   CONNECTION INFORMATION
   ========================================================= */

function getConnectionInfo() {

  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;


  if (!connection) {

    return null;

  }


  return {

    effectiveType:
      connection.effectiveType,

    downlink:
      connection.downlink,

    rtt:
      connection.rtt,

    saveData:
      connection.saveData

  };

}


/* =========================================================
   LOG NETWORK INFORMATION
   ========================================================= */

function checkNetwork() {

  const info =
    getConnectionInfo();


  if (!info) {
    return;
  }


  console.log(
    "Network:",
    info
  );

}


checkNetwork();


/* =========================================================
   NETWORK CHANGE
   ========================================================= */

const connection =
  navigator.connection ||
  navigator.mozConnection ||
  navigator.webkitConnection;


if (connection) {

  connection.addEventListener(
    "change",
    () => {

      console.log(
        "Network changed:",
        getConnectionInfo()
      );

    }
  );

}


/* =========================================================
   TYPING SEARCH SUGGESTIONS
   ========================================================= */

function startTypingSuggestions() {

  if (!songs.length) return;


  let i = 0;

  let j = 0;

  let deleting = false;

  let typingPaused = false;


  function type() {

    if (
      typingPaused ||
      document.hidden
    ) {

      return;

    }


    const current =
      songs[i].title;


    if (!deleting) {

      searchInput.placeholder =
        "Search " +
        current.substring(
          0,
          j++
        );


      if (
        j >
        current.length
      ) {

        deleting = true;

        setTimeout(
          type,
          500
        );

        return;

      }

    } else {

      searchInput.placeholder =
        "Search " +
        current.substring(
          0,
          j--
        );


      if (j < 0) {

        deleting = false;

        i =
          (i + 1) %
          songs.length;

        j = 0;

      }

    }


    setTimeout(
      type,
      deleting ? 50 : 80
    );

  }


  searchInput.addEventListener(
    "input",
    () => {

      if (
        searchInput.value.length > 0
      ) {

        typingPaused = true;

        searchInput.placeholder =
          "Search...";

      } else {

        if (typingPaused) {

          typingPaused = false;

          j = 0;

          type();

        }

      }

    }
  );


  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        !document.hidden &&
        !typingPaused
      ) {

        type();

      }

    }
  );


  type();

}


/* =========================================================
   SECURITY
   ========================================================= */

document.addEventListener(
  "contextmenu",
  e => e.preventDefault()
);


document.onkeydown = e => {

  if (
    e.keyCode === 123 ||

    (
      e.ctrlKey &&
      e.shiftKey &&
      [73, 74].includes(
        e.keyCode
      )
    ) ||

    (
      e.ctrlKey &&
      e.keyCode === 85
    )

  ) {

    return false;

  }

};


/* =========================================================
   AUTO HIDE TOAST
   ========================================================= */

window.addEventListener(
  "DOMContentLoaded",
  () => {

    setTimeout(
      () => {

        const toast =
          document.getElementById(
            "toastNotice"
          );


        if (toast) {

          toast.style.transition =
            "opacity 0.5s ease";


          toast.style.opacity =
            "0";


          setTimeout(
            () => toast.remove(),
            500
          );

        }

      },
      6000
    );

  }
);


/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

document.addEventListener(
  "keydown",
  e => {

    /*
     * Don't interfere with search box.
     */

    if (
      document.activeElement ===
      searchInput
    ) {

      return;

    }


    switch (e.key) {

      case " ":

        e.preventDefault();

        playPause();

        break;


      case "ArrowRight":

        e.preventDefault();

        /*
         * If media is playing, next song.
         */

        nextSong();

        break;


      case "ArrowLeft":

        e.preventDefault();

        prevSong();

        break;


      case "s":

      case "S":

        toggleShuffle();

        break;


      case "ArrowUp":

        e.preventDefault();

        audio.volume =
          Math.min(
            1,
            audio.volume + 0.1
          );

        break;


      case "ArrowDown":

        e.preventDefault();

        audio.volume =
          Math.max(
            0,
            audio.volume - 0.1
          );

        break;

    }

  }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

window.addEventListener(
  "DOMContentLoaded",
  loadSongs
);
