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

  // Simple in-memory cache so re-rendering the list / re-checking song data
  // doesn't require re-fetching music.json within the same session.
  const SONGS_CACHE_KEY = "musicJsonCache";
  const SONGS_CACHE_TTL_MS = 1000 * 60 * 30; // 30 min

  async function loadSongs() {
    titleEl.textContent = "Loading songs...";
    try {
      let data;

      // Try a short-lived localStorage cache first to avoid re-downloading
      // music.json on every page load (small file, but adds up on flaky connections).
      const cached = localStorage.getItem(SONGS_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.ts && Date.now() - parsed.ts < SONGS_CACHE_TTL_MS) {
            data = parsed.data;
          }
        } catch (_) { /* ignore corrupt cache */ }
      }

      if (!data) {
        const res = await fetch("music.json");
        data = await res.json();
        try {
          localStorage.setItem(SONGS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
        } catch (_) { /* storage full or unavailable, ignore */ }
      }

      // 🔹 Convert plain strings → objects for consistency
      songs = data.map(file => ({
        file,
        title: file.replace(".mp3", ""), // use filename as title
        album: "My Playlist",
        artwork: "images/music.png"
      }));

      if (!songs.length) {
        titleEl.textContent = "No songs found.";
        return;
      }

      const savedIndex = parseInt(localStorage.getItem("lastIndex"));
      const savedTime = parseFloat(localStorage.getItem("lastTime"));

      currentIndex = !isNaN(savedIndex) ? savedIndex : 0;
      loadSong(currentIndex);

      if (!isNaN(savedTime)) {
        audio.addEventListener("loadedmetadata", () => {
          if (restoringFromLocal) {
            audio.currentTime = savedTime;
            restoringFromLocal = false;
          }
        });
      }

      renderSongList();
      startTypingSuggestions();
    } catch (err) {
      titleEl.textContent = "Error loading songs.";
      console.error(err);
    }
  }

  function loadSong(index, fromClick = false) {
    const song = songs[index];
    if (!song) return;

    audio.src = `songs/${song.file}`;
    titleEl.textContent = song.title;
    document.getElementById("cover").src = song.artwork;

    if (fromClick) {
      audio.currentTime = 0;
      restoringFromLocal = false;
    }

    highlightSong();
    updateMediaSession(song);
  }

  // 🔹 MediaSession API for lockscreen
 function updateMediaSession(song) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: [
        { src: "images/Music_square.png", sizes: "any", type: "image/png" }
      ]
    });

    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prevSong);
    navigator.mediaSession.setActionHandler("nexttrack", nextSong);
  }
}

  function playPause() {
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function prevSong() {
    currentIndex = (currentIndex - 1 + songs.length) % songs.length;
    loadSong(currentIndex);
    audio.play();
  }

  function nextSong() {
    if (isShuffling) {
      let next;
      do {
        next = Math.floor(Math.random() * songs.length);
      } while (next === currentIndex);
      currentIndex = next;
    } else {
      currentIndex = (currentIndex + 1) % songs.length;
    }
    loadSong(currentIndex);
    audio.play();
  }

  function toggleShuffle() {
    isShuffling = !isShuffling;
    shuffleIcon.classList.toggle("text-green-400", isShuffling);
  }

  function highlightSong() {
    [...songListEl.children].forEach((li, i) => {
      li.classList.toggle("bg-indigo-800", i === currentIndex);
    });
  }

  function renderSongList(filtered = songs) {
    songListEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    filtered.forEach((song) => {
      const li = document.createElement("li");
      li.className = "px-4 py-2 cursor-pointer hover:bg-indigo-700 rounded-md";
      li.textContent = song.title;
      li.onclick = () => {
        currentIndex = songs.indexOf(song);
        loadSong(currentIndex, true);
        audio.play();
      };
      frag.appendChild(li);
    });
    songListEl.appendChild(frag);
    highlightSong();
  }

  function sortSongs() {
    songs.sort((a, b) => a.title.localeCompare(b.title));
    renderSongList();
  }

  function filterSongs() {
    const keyword = searchInput.value.toLowerCase();
    const filtered = songs.filter(song =>
      song.title.toLowerCase().includes(keyword)
    );
    renderSongList(filtered);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // Throttle localStorage writes: timeupdate fires several times a second,
  // writing to disk that often is unnecessary and drains battery/CPU on mobile.
  let lastPositionSave = 0;
  audio.addEventListener("timeupdate", () => {
    const percent = (audio.currentTime / audio.duration) * 100;
    progress.value = percent || 0;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    totalTimeEl.textContent = formatTime(audio.duration || 0);

    const now = Date.now();
    if (now - lastPositionSave > 2000) {
      localStorage.setItem("lastIndex", currentIndex);
      localStorage.setItem("lastTime", audio.currentTime);
      lastPositionSave = now;
    }
  });

  progress.addEventListener("input", () => {
    audio.currentTime = (progress.value / 100) * audio.duration;
  });

  audio.addEventListener("ended", nextSong);

  audio.addEventListener("play", () => {
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
  });

  audio.addEventListener("pause", () => {
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
    // Save immediately on pause so we don't lose up to 2s of position on throttle.
    localStorage.setItem("lastIndex", currentIndex);
    localStorage.setItem("lastTime", audio.currentTime);
  });

  // 🔹 Animated typing suggestion in search bar
  function startTypingSuggestions() {
    if (!songs.length) return;
    let i = 0, j = 0;
    let deleting = false;
    let typingPaused = false;

    function type() {
      if (typingPaused || document.hidden) return;

      const current = songs[i].title;
      if (!deleting) {
        searchInput.placeholder = "Search " + current.substring(0, j++);
        if (j > current.length) {
          deleting = true;
          setTimeout(type, 500);
          return;
        }
      } else {
        searchInput.placeholder = "Search " + current.substring(0, j--);
        if (j < 0) {
          deleting = false;
          i = (i + 1) % songs.length;
          j = 0;
        }
      }
      setTimeout(type, deleting ? 50 : 80);
    }

    searchInput.addEventListener("input", () => {
      if (searchInput.value.length > 0) {
        typingPaused = true;
        searchInput.placeholder = "Search...";
      } else {
        if (typingPaused) {
          typingPaused = false;
          j = 0;
          type();
        }
      }
    });

    // Pause the animation loop while the tab/screen is backgrounded,
    // saves battery/CPU on mobile instead of ticking forever in the background.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !typingPaused) {
        type();
      }
    });

    type();
  }

  window.addEventListener("DOMContentLoaded", loadSongs);

<!-- Security: Disable right-click and dev tools -->

  document.addEventListener('contextmenu', e => e.preventDefault());
  document.onkeydown = e => {
    if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && [73, 74].includes(e.keyCode)) || (e.ctrlKey && e.keyCode === 85)) {
      return false;
    }
  };


  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const toast = document.getElementById("toastNotice");
      if (toast) {
        toast.style.transition = "opacity 0.5s ease";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 500);
      }
    }, 6000); // 6 seconds
  });

  document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case " ": // Play / Pause
      e.preventDefault();
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
      break;

    case "ArrowRight": // Next
      nextSong();
      break;

    case "ArrowLeft": // Previous
      prevSong();
      break;

    case "s": // Shuffle toggle
    case "S":
      shuffle = !shuffle;
      alert("Shuffle " + (shuffle ? "On" : "Off"));
      break;

    case "r": // Repeat toggle
    case "R":
      repeat = !repeat;
      alert("Repeat " + (repeat ? "On" : "Off"));
      break;

    case "ArrowUp": // Volume up
      audio.volume = Math.min(1, audio.volume + 0.1);
      break;

    case "ArrowDown": // Volume down
      audio.volume = Math.max(0, audio.volume - 0.1);
      break;
  }
});
