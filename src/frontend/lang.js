/**
 * lang.js - KORAI Music Player Internationalization
 * 
 * Multi-language support for English and Persian (Farsi)
 * Contains all UI text strings for complete localization
 */

const translations = {
    en: {
        // Navigation & UI
        navArtistsText: "Artists",
        githubBtnText: "Star on GitHub",
        profileName: "KORAI Personal Space",
        profileBio: "Sleek and minimalist local audio player & manager.",
        langBtnText: "FA",
        menuTitle: "Playlists Library",
        navHomeText: "Home",
        navLibText: "My Library",
        navFavText: "Favorites",
        navStatsText: "Live Telemetry",
        
        // AI Panel
        aiPanelTitle: "Acoustic AI",
        aiPanelDesc: "Analyzes dynamic frequency footprints, tempo, and harmonic energy to discover matching vibes.",
        aiBtnText: "Analyze Waveform",
        
        // Import options
        upTextTitle: "Import Audio File",
        upTextSub: "Add single local track",
        upFolderTitle: "Scan Audio Folder",
        upFolderSub: "Bulk import entire directory",
        upUrlTitle: "Stream from Link",
        upUrlSub: "Direct URL capture",
        
        // Loading and welcome
        loadingText: "Configuring KORAI Audio Core...",
        welcomeMorning: "Good Morning",
        welcomeAfternoon: "Good Afternoon",
        welcomeEvening: "Good Evening",
        
        // Empty states
        emptyLibrary: "Your Library is Empty",
        emptyLibraryDesc: "Use the import options on the sidebar to add your local audio tracks.",
        emptyFavs: "No Favorites Yet",
        emptyFavsDesc: "Like your favorite songs to see them grouped here.",
        
        // Statistics
        statsTitle: "Playback Analytics & Stats",
        statsTotal: "Total Tracks",
        statsPlays: "Total Playbacks",
        statsLikes: "Liked Tracks",
        statsHero: "Most Played Masterpiece",
        
        // Queue and fullscreen
        queuePanelTitle: "Active Play Queue",
        fsExitText: "Exit Immersive Stage",
        
        // Modals
        playlistModalTitle: "Create New Playlist",
        playlistPlaceholder: "Enter playlist name...",
        dialogConfirm: "Confirm",
        dialogCancel: "Cancel",
        createPlaylist: "Create Playlist",
        downloadModalTitle: "Download MP3 from Link",
        downloadPlaceholder: "Paste direct audio stream URL here...",
        downloadBtn: "Download & Import",
        
        // Library
        searchPlaceholder: "Search songs, artists, albums...",
        rightClickTip: "Right-click on tracks to manage playlists",
        libraryArchive: "Music Library Archive",
        dailySuggestions: "Curated Daily Discoveries",
        
        // OOBE Welcome Screen
        welcomeOobeTitle: "Welcome to KORAI Stage",
        welcomeOobeSub: "Immersive local audio system designed for audiophiles",
        welcomeOobeGoalTitle: "Project Core",
        welcomeOobeGoalDesc: "A beautiful, modern, and completely free music player. Built to provide endless and powerful features, usable on all computers without any limitations. This project is ready for development and achieving greater goals.",
        welcomeOobeCreatorTitle: "The Craft",
        welcomeOobeCreatorDesc: "I am Behdad Kanaani, a teenage programmer and lover of music, AI, computer vision, and everything related to programming and computers. I have many projects; visit my GitHub to see them.",
        welcomeOobeBtn: "Initialize Studio Core",
        
        // DSP Controls
        dspPreservePitch: "Preserve Pitch:",
        dspTitle: "Graphic Studio Equalizer",
        
        // Stats labels
        totalTracksLabel: "Total Loaded Tracks",
        totalPlaysLabel: "Cumulative Playbacks",
        popularLabel: "Loved Tracks",
        topTrackLabel: "Your top music based on execution telemetry",
        liveSpectrumLabel: "Live Spectrum Telemetry Analyzer",
        statsError: "Failed to retrieve analytics data from server",
        playedTimes: "plays",
        
        // Playlist
        emptyPlaylistState: "This playlist is empty",
        emptyPlaylistTip: "Right-click on tracks in My Library to append them here.",
        
        // Badges
        bpmBadge: "BPM",
        energyBadge: "Energy Profile",
        noLyrics: "Lyrics not found in metadata container.",

        // Playback controls
        playPause: "Play/Pause",
        previousTrack: "Previous",
        nextTrack: "Next",
        shuffle: "Shuffle Mode",
        repeat: "Repeat Mode",
        volume: "Master Volume",
        
        // Sleep timer
        sleepTimer: "Sleep Timer:",
        sleepOff: "Disabled",
        sleepMinutes: "Min",
        cancel: "Cancel Timer",
        
        // Karaoke
        karaokeMode: "Karaoke Mode (Real-time Vocal Cancellation):",
        
        // Drag and drop
        dragNotify: "Analyzing dropped files...",
        dragSuccess: "tracks successfully imported!",
        dragError: "Failed to import dropped files.",
        
        // Equalizer labels
        eq60Hz: "Bass (60Hz)",
        eq230Hz: "Low Mid (230Hz)",
        eq910Hz: "Mid (910Hz)",
        eq4kHz: "High Mid (4kHz)",
        eq14kHz: "Treble (14kHz)",
        tempo: "Playback Tempo",
        
        // Recommendations
        similarPlaylist: "Generate Smart Playlist",
        genreDetected: "Identified Genre",
        smartRecommendations: "KORAI Dynamic Feed",
        backToHome: "Back to Dashboard",
        playlistCreated: "Dynamic playlist constructed successfully",
        noSimilarTracks: "No matching acoustic profiles found",
        analyzingAudio: "Decrypting audio patterns...",
        
        // Genre translations
        genreBlues: "Blues / Jazz Acoustic",
        genreClassical: "Classical / Orchestral",
        genrePop: "Vocal Pop / Indie",
        genreDance: "Electronic Dance / House",
        genreEDM: "Club EDM / Trance",
        genreDnB: "Drum & Bass / Kinetic",
        genreHipHop: "Hip Hop / Urban Beat",
        genreMetal: "Rock / Heavy Metal",
        genreElectronic: "Synthwave / Electronic",

        similarity: "Similarity",
        recommended: "Recommended",

        // New Sorting & Filtering Translations
        sortByLabel: "Sort By:",
        sortDateAdded: "Date Added",
        sortTitle: "Title",
        sortArtist: "Artist",
        sortBpm: "BPM",
        sortDuration: "Duration",
        allGenres: "All Genres",
        navAdvSearch: "Advanced Search",
        exportLibrary: "Export Library",
        importCue: "Import CUE Sheet",
    },
    fa: {
        // Navigation & UI
        githubBtnText: "ستاره در گیت‌هاب",
        profileName: "کتابخانه شخصی KORAI",
        profileBio: "سیستم مدیریت و پخش هوشمند موسیقی محلی.",
        langBtnText: "EN",
        menuTitle: "لیست‌های پخش",
        navHomeText: "صفحه اصلی",
        navLibText: "کتابخانه من",
        navFavText: "مورد علاقه‌ها",
        navStatsText: "تله‌متری زنده",
        navArtistsText: "آرتیست‌ها",
        
        // AI Panel
        aiPanelTitle: "هوش مصنوعی صوتی",
        aiPanelDesc: "تحلیل الگوهای فرکانسی، سرعت ضربان (BPM) و انرژی موج جاری برای کشف نواهای هم‌سو.",
        aiBtnText: "تحلیل سیگنال صوتی",
        
        // Import options
        upTextTitle: "افزودن قطعه صوتی",
        upTextSub: "وارد کردن فایل تکی",
        upFolderTitle: "اسکن کامل پوشه",
        upFolderSub: "بارگذاری گروهی دایرکتوری",
        upUrlTitle: "استریم مستقیم از وب",
        upUrlSub: "دریافت آنلاین پیوند MP3",
        
        // Loading and welcome
        loadingText: "در حال پیکربندی موتور صوتی KORAI...",
        welcomeMorning: "صبح بخیر",
        welcomeAfternoon: "ظهر بخیر",
        welcomeEvening: "عصر بخیر",
        
        // Empty states
        emptyLibrary: "کتابخانه موسیقی شما خالی است",
        emptyLibraryDesc: "جهت افزودن آهنگ، از گزینه‌های پنل مدیریت سایدبار استفاده نمایید.",
        emptyFavs: "لیست علاقه‌مندی‌ها خالی است",
        emptyFavsDesc: "آهنگ‌های محبوب خود را لایک کنید تا در این بخش طبقه‌بندی شوند.",
        
        // Statistics
        statsTitle: "آمار و تله‌متری پخش",
        statsTotal: "کل آهنگ‌ها",
        statsPlays: "دفعات پخش",
        statsLikes: "محبوب‌ترین‌ها",
        statsHero: "شاهکار صدر جدول پخش شما",
        
        // Queue and fullscreen
        queuePanelTitle: "صف پخش جاری فعال",
        fsExitText: "خروج از استیج سینمایی",
        
        // Modals
        playlistModalTitle: "ایجاد لیست پخش جدید",
        playlistPlaceholder: "نام پلی‌لیست را وارد کنید...",
        dialogConfirm: "تایید",
        dialogCancel: "انصراف",
        createPlaylist: "ایجاد لیست پخش",
        downloadModalTitle: "دانلود فایل صوتی از لینک",
        downloadPlaceholder: "آدرس لینک مستقیم استریم MP3 را وارد کنید...",
        downloadBtn: "دانلود و بارگذاری",
        
        // Library
        searchPlaceholder: "جستجوی آهنگ، خواننده، آلبوم...",
        rightClickTip: "برای مدیریت و افزودن آهنگ‌ها به پلی‌لیست راست‌کلیک کنید",
        libraryArchive: "آرشیو جامع کتابخانه موسیقی",
        dailySuggestions: "پیشنهادهای هوشمند روزانه",
        
        // OOBE Welcome Screen
        welcomeOobeTitle: "به استیج KORAI خوش آمدید",
        welcomeOobeSub: "سیستم صوتی بومی و سینمایی طراحی شده برای علاقه‌مندان به موسیقی تراز اول",
        welcomeOobeGoalTitle: "هسته پروژه",
        welcomeOobeGoalDesc: "پلیر موسیقی زیبا، مدرن و کاملاً رایگان. ساخته شده برای ارائه امکانات بی‌پایان و خفن، قابل استفاده روی تمام کامپیوترها بدون هیچ محدودیتی. این پروژه آماده توسعه و دستیابی به اهداف بزرگ‌تر است.",
        welcomeOobeCreatorTitle: "توسعه و هنر",
        welcomeOobeCreatorDesc: "من بهداد کنعانی هستم، یک نوجوان برنامه‌نویس و عاشق موسیقی، هوش مصنوعی، بینایی کامپیوتر و هر چیزی که به برنامه‌نویسی و کامپیوتر ربط داشته باشد. پروژه‌های زیادی دارم؛ برای دیدن آن‌ها به گیت‌هاب من سر بزنید.",
        welcomeOobeBtn: "راه‌اندازی هسته صوتی کلاینت",
        
        // DSP Controls
        dspPreservePitch: "حفظ گام صدا (Preserve Pitch):",
        dspTitle: "اکولایزر گرافیکی استودیویی",
        
        // Stats labels
        totalTracksLabel: "کل قطعات بارگذاری شده",
        totalPlaysLabel: "کل دفعات پخش ثبت شده",
        popularLabel: "آثار مورد علاقه",
        topTrackLabel: "این اثر بر اساس تله‌متری سیستم پخش شما در صدر قرار دارد",
        liveSpectrumLabel: "Live Spectrum Telemetry Analyzer",
        statsError: "خطا در دریافت اطلاعات آمار از سرور اصلی",
        playedTimes: "بار پخش",
        
        // Playlist
        emptyPlaylistState: "این لیست پخش خالی است",
        emptyPlaylistTip: "در بخش «کتابخانه من» با راست‌کلیک روی آهنگ‌ها، آن‌ها را به این لیست اضافه کنید.",
        
        // Badges
        bpmBadge: "BPM",
        energyBadge: "نمایه انرژی",
        noLyrics: "متن شعر در کانتینر متادیتای صوتی یافت نشد.",

        // Playback controls
        playPause: "پخش/توقف",
        previousTrack: "پخش قبلی",
        nextTrack: "پخش بعدی",
        shuffle: "پخش تصادفی",
        repeat: "تکرار مجدد",
        volume: "بلندی صدای کل",
        
        // Sleep timer
        sleepTimer: "تایمر خواب:",
        sleepOff: "غیرفعال",
        sleepMinutes: "دقیقه",
        cancel: "لغو تایمر",
        
        // Karaoke
        karaokeMode: "حالت کارائوکه (حذف بلادرنگ صدای خواننده):",
        
        // Drag and drop
        dragNotify: "در حال بررسی و تحلیل فایل‌های صوتی رها شده...",
        dragSuccess: "قطعه جدید با موفقیت به آرشیو افزوده شد!",
        dragError: "خطا در پردازش فایل‌های صوتی رها شده.",
        
        // Equalizer labels
        eq60Hz: "بیس (60Hz)",
        eq230Hz: "میانی پایین (230Hz)",
        eq910Hz: "میانی (910Hz)",
        eq4kHz: "میانی بالا (4kHz)",
        eq14kHz: "زیر (14kHz)",
        tempo: "سرعت پخش (تمپو)",
        
        // Recommendations
        similarPlaylist: "ساخت پلی‌لیست هم‌سبک",
        genreDetected: "سبک شناسایی شده",
        smartRecommendations: "پیشنهادهای داینامیک KORAI",
        backToHome: "بازگشت به پیشخوان",
        playlistCreated: "لیست پخش هم‌نمایه با موفقیت ایجاد شد",
        noSimilarTracks: "هیچ نمایه فرکانسی مشابهی در کتابخانه یافت نشد",
        analyzingAudio: "رمزگشایی از الگوهای صوتی...",
        
        // Genre translations
        genreBlues: "بلوز / جاز آکوستیک",
        genreClassical: "کلاسیک / ارکسترال",
        genrePop: "پاپ باکال / ایندی",
        genreDance: "الکترونیک دنس / هاوس",
        genreEDM: "کلاب EDM / ترنس",
        genreDnB: "درام اند بیس / پرانرژی",
        genreHipHop: "هیپ هاپ / اوربان بیت",
        genreMetal: "راک / هوی متال",
        genreElectronic: "سینث‌ویو / الکترونیک",

        similarity: "شباهت",
        recommended: "توصیه شده",

        // New Sorting & Filtering Translations
        sortByLabel: "مرتب‌سازی بر اساس:",
        sortDateAdded: "تاریخ اضافه شدن",
        sortTitle: "عنوان آهنگ",
        sortArtist: "خواننده",
        sortBpm: "ضربان (BPM)",
        sortDuration: "مدت زمان",
        allGenres: "همه سبک‌ها",
        navAdvSearch: "جستجوی پیشرفته",
        exportLibrary: "خروجی کتابخانه",
        importCue: "وارد کردن CUE Sheet",
    }
};