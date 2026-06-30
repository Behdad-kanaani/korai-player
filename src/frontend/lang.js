const translations = {
    en: {
        // ===== Time-based greetings =====
        welcomeEarlyMorning: "☀️ Rise & shine! Ready for some fresh beats?",
        welcomeMorningPeak: "🌅 Good morning! Your morning energy is peaking",
        welcomeLateMorning: "🎵 Morning vibes! Time for your daily soundtrack",
        welcomeNoon: "🌤️ Good noon! Lunch break melodies?",
        welcomeAfternoon: "☕ Good afternoon! Keep the rhythm flowing",
        welcomeEarlyEvening: "🌆 Good evening! Wind down with some tunes",
        welcomeEvening: "✨ Good evening! Your musical journey continues",
        welcomeLateNight: "🌙 Late night session? Let the music speak",
        welcomeMidnight: "🕛 Midnight melodies... find your peace",
        welcomeDeepNight: "⭐ Deep night vibes... just you and the music",

        // ===== Navigation & Sidebar =====
        navHomeText: "Home",
        navLibText: "My Library",
        navArtistsText: "Artists",
        navAlbumsText: "Albums",
        navFavText: "Favorites",
        navStatsText: "Live Telemetry",
        navAdvSearch: "Advanced Search",
        navSettingsText: "Settings",

        // ===== Profile & Header =====
        githubBtnText: "Star on GitHub",
        profileName: "KORAI Personal Space",
        profileBio: "Sleek and minimalist local audio player & manager.",
        langBtnText: "FA",

        // ===== Playlists =====
        menuTitle: "Playlists Library",

        // ===== AI & Tools Panel =====
        aiPanelTitle: "Acoustic AI",
        aiPanelDesc: "",
        aiBtnText: "Analyze Waveform",
        similarPlaylist: "Smart Playlist",
        exportLibrary: "Export Library",
        importCue: "Import CUE",

        // ===== Import Options =====
        upTextTitle: "Import Audio File",
        upTextSub: "Add single local track",
        upFolderTitle: "Scan Audio Folder",
        upFolderSub: "Bulk import entire directory",
        upUrlTitle: "Stream from Link",
        upUrlSub: "Direct URL capture",

        // ===== Splash & Loading =====
        loadingText: "Configuring KORAI Audio Core...",

        // ===== Empty States =====
        emptyLibrary: "Your Library is Empty",
        emptyLibraryDesc: "Use the import options on the sidebar to add your local audio tracks.",
        emptyFavs: "No Favorites Yet",
        emptyFavsDesc: "Like your favorite songs to see them grouped here.",
        emptyArtistsState: "No Artists Found",
        emptyArtistsDesc: "Add some music tracks to see your artists.",
        emptyAlbumsState: "No Albums Found",
        emptyAlbumsDesc: "Add music to see your albums.",
        emptyPlaylistState: "This playlist is empty",
        emptyPlaylistTip: "Right-click on tracks in My Library to append them here.",

        // ===== Statistics =====
        statsTitle: "Playback Analytics & Stats",
        statsTotal: "Total Tracks",
        statsPlays: "Total Playbacks",
        statsLikes: "Liked Tracks",
        statsHero: "Most Played Masterpiece",
        totalTracksLabel: "Total Loaded Tracks",
        totalPlaysLabel: "Cumulative Playbacks",
        popularLabel: "Loved Tracks",
        topTrackLabel: "Your top music based on execution telemetry",
        liveSpectrumLabel: "Live Spectrum Telemetry Analyzer",
        statsError: "Failed to retrieve analytics data from server",
        playedTimes: "plays",

        // ===== Queue =====
        queuePanelTitle: "Active Play Queue",

        // ===== Fullscreen Player =====
        fsExitText: "Exit Immersive Stage",

        // ===== Modals =====
        playlistModalTitle: "Create New Playlist",
        playlistPlaceholder: "Enter playlist name...",
        dialogConfirm: "Confirm",
        dialogCancel: "Cancel",
        createPlaylist: "Create Playlist",
        downloadModalTitle: "Download MP3 from Link",
        downloadPlaceholder: "Paste direct audio stream URL here...",
        downloadBtn: "Download & Import",

        // ===== Search & Library =====
        searchPlaceholder: "Search songs, artists, albums...",
        rightClickTip: "Right-click on tracks to manage playlists",
        libraryArchive: "Music Library Archive",
        dailySuggestions: "Curated Daily Discoveries",

        // ===== Welcome / OOBE =====
        welcomeOobeTitle: "Welcome to KORAI Stage",
        welcomeOobeSub: "Immersive local audio system designed for audiophiles",
        welcomeOobeGoalTitle: "Project Core",
        welcomeOobeGoalDesc: "A beautiful, modern, and completely free music player. Built to provide endless and powerful features, usable on all computers without any limitations. This project is ready for development and achieving greater goals.",
        welcomeOobeCreatorTitle: "The Craft",
        welcomeOobeCreatorDesc: "I am Behdad Kanaani, a teenage programmer and lover of music, AI, computer vision, and everything related to programming and computers. I have many projects; visit my GitHub to see them.",
        welcomeOobeBtn: "Initialize Studio Core",

        // ===== DSP & EQ =====
        dspTitle: "Graphic Studio Equalizer",
        dspPreservePitch: "Preserve Pitch:",
        tempo: "Playback Tempo",

        // ===== Vocal Separator =====
        vocalSeparatorMode: "Vocal Separator (Real-time Vocal Removal):",
        vocalSeparatorIntensity: "Vocal Removal Intensity",
        vocalSeparatorSensitivity: "Detection Sensitivity",
        vocalSeparatorSensitivityDesc: "Lower = more aggressive removal, Higher = preserves more instruments",
        vocalSeparatorActive: "🎤 Vocal Separator: AI Vocal Removal Active",
        vocalSeparatorDisabled: "Vocal Separator Disabled",
        vocalSeparatorError: "Vocal separator failed to initialize",
        vocalSeparatorFirstPlay: "Play a track first to enable Vocal Separator",

        // ===== EQ Bands =====
        eq60Hz: "Bass (60Hz)",
        eq230Hz: "Low Mid (230Hz)",
        eq910Hz: "Mid (910Hz)",
        eq4kHz: "High Mid (4kHz)",
        eq14kHz: "Treble (14kHz)",

        // ===== Track Info =====
        bpmBadge: "BPM",
        energyBadge: "Energy Profile",
        noLyrics: "Lyrics not found in metadata container.",
        trackTitle: "Title",
        albumTitle: "Album",
        actions: "Actions",
        artist: "Artist",
        genre: "Genre",
        duration: "Duration",
        codec: "Codec",
        bitrate: "Bitrate",
        sampleRate: "Sample Rate",
        energy: "Energy",

        // ===== Playback Controls =====
        playPause: "Play/Pause",
        previousTrack: "Previous",
        nextTrack: "Next",
        shuffle: "Shuffle Mode",
        repeat: "Repeat Mode",
        volume: "Master Volume",

        // ===== Sleep Timer =====
        sleepTimer: "Sleep Timer:",
        sleepOff: "Disabled",
        sleepMinutes: "Min",
        cancel: "Cancel Timer",

        // ===== Drag & Drop =====
        dragNotify: "Analyzing dropped files...",
        dragSuccess: "tracks successfully imported!",
        dragError: "Failed to import dropped files.",

        // ===== Genres =====
        genreDetected: "Identified Genre",
        genreBlues: "Blues / Jazz Acoustic",
        genreChill: "Chill / LoFi / Relaxing",
        genreClassical: "Classical / Orchestral",
        genreAcoustic: "Acoustic / Folk",
        genrePop: "Vocal Pop / Indie",
        genreDance: "Electronic Dance / House",
        genreEDM: "Club EDM / Trance",
        genreDnB: "Drum & Bass / Kinetic",
        genreHipHop: "Hip Hop / Urban Beat",
        genreMetal: "Rock / Heavy Metal",
        genreElectronic: "Synthwave / Electronic",
        genreLatin: "Latin / Reggae / Tropical",

        // ===== AI / Recommendations =====
        smartRecommendations: "KORAI Dynamic Feed",
        backToHome: "Back to Dashboard",
        playlistCreated: "Dynamic playlist constructed successfully",
        noSimilarTracks: "No matching acoustic profiles found",
        analyzingAudio: "Decrypting audio patterns...",
        similarity: "Similarity",
        recommended: "Recommended",

        // ===== Library Sorting =====
        sortByLabel: "Sort By:",
        sortDateAdded: "Date Added",
        sortTitle: "Title",
        sortArtist: "Artist",
        sortBpm: "BPM",
        sortDuration: "Duration",
        allGenres: "All Genres",

        // ===== Artists =====
        artistsTitle: "Artists",
        tracksCount: "tracks",
        playingArtist: "Playing",
        backToArtists: "Back to Artists",
        playArtist: "Play All",

        // ===== Albums =====
        albumsTitle: "Albums",
        backToAlbums: "Back to Albums",
        playAlbum: "Play All",

        // ===== Favorites =====
        likedTracks: "Liked Tracks",
        totalPlays: "Total Plays",
        topLiked: "Top Liked",
        recentlyAdded: "Recently Added",

        // ===== Vocal Extraction =====
        extractionInProgress: "Extraction already in progress",
        preparingExtraction: "Preparing vocal extraction...",
        extractingVocal: "Separating vocals...",
        addingToLibrary: "Adding to library...",
        extractionComplete: "Extraction complete!",
        vocalTrackAdded: "Vocal track added",
        extractionNoTrack: "Track added but could not play automatically",
        extractionFailed: "Extraction failed",
        noTrackPlaying: "No track playing",

        // ===== Settings Page (NEW) =====
        settingsTitle: "Settings",
        settingsSubtitle: "Configure your KORAI experience",

        // Navigation
        settingsNavPlayback: "Playback",
        settingsNavAudio: "Audio & EQ",
        settingsNavAppearance: "Appearance",
        settingsNavLibrary: "Library",
        settingsNavPlugins: "Plugins",
        settingsNavAI: "AI & Recommendations",
        settingsNavSystem: "System & Tray",
        settingsNavAdvanced: "Advanced",
        settingsBackToPlayer: "Back to Player",

        // Playback section
        playbackGapless: "Gapless Playback",
        playbackGaplessDesc: "Seamless transition between tracks",
        playbackCrossfade: "Crossfade Duration",
        playbackCrossfadeDesc: "Fade duration between tracks",
        playbackRepeatMode: "Default Repeat Mode",
        playbackRepeatModeDesc: "Repeat behavior when starting playback",
        playbackShuffleDefault: "Default Shuffle Mode",
        playbackShuffleDefaultDesc: "Enable shuffle by default",
        playbackResumeOnStart: "Resume on Start",
        playbackResumeOnStartDesc: "Continue playback from last position when launching",

        // Audio section
        audioDefaultVolume: "Default Volume",
        audioDefaultVolumeDesc: "Initial volume level",
        audioOutput: "Audio Output",
        audioOutputDesc: "Stereo or Mono output",
        audioEqPresets: "Equalizer Presets",
        audioEqFlat: "Flat",
        audioEqRock: "Rock",
        audioEqPop: "Pop",
        audioEqClassical: "Classical",
        audioEqBass: "Bass Boost",
        audioEqTreble: "Treble Boost",

        // Appearance section
        appearanceTheme: "Theme",
        appearanceThemeDesc: "Select visual theme",
        appearanceThemeDefault: "Default",
        appearanceThemeLiquidGlass: "Liquid Glass",
        appearanceDirection: "Direction",
        appearanceDirectionDesc: "UI text direction",
        appearanceDirectionLTR: "LTR (English)",
        appearanceDirectionRTL: "RTL (Persian)",
        appearanceFontSize: "Font Size",
        appearanceFontSizeDesc: "Adjust text size",
        appearanceFontSizeSmall: "Small",
        appearanceFontSizeMedium: "Medium",
        appearanceFontSizeLarge: "Large",
        appearanceShowAlbumArt: "Show Album Art in Player",
        appearanceShowAlbumArtDesc: "Display cover art in the playback bar",

        // Library section
        libraryScanPath: "Default Scan Path",
        libraryScanPathDesc: "Folder to scan for music",
        libraryScanPathNotSet: "Not set",
        librarySelectFolder: "Select Folder",
        libraryFormats: "Supported Formats",
        libraryFormatsDesc: "Audio formats to scan",
        libraryAutoScan: "Auto-Scan on Startup",
        libraryAutoScanDesc: "Automatically scan library folder when launching",
        libraryMaxScanDepth: "Max Scan Depth",
        libraryMaxScanDepthDesc: "How deep to scan subfolders",

        // Plugins section
        pluginsAutoActivate: "Auto-Activate Critical Plugins",
        pluginsAutoActivateDesc: "Start essential plugins automatically",
        pluginsHotReload: "Hot-Reload for Development",
        pluginsHotReloadDesc: "Reload plugins automatically on file change",
        pluginsHookTimeout: "Hook Timeout",
        pluginsHookTimeoutDesc: "Timeout for plugin hook execution",
        pluginsMemory: "Max Memory per Plugin",
        pluginsMemoryDesc: "Memory limit for each plugin",

        // AI section
        aiEnable: "Enable AI Recommendations",
        aiEnableDesc: "Personalized track suggestions",
        aiDiscovery: "Discovery Mode",
        aiDiscoveryDesc: "Suggest new and unheard tracks",
        aiWeights: "Behavior Weights",
        aiWeightsDesc: "Adjust how each interaction affects recommendations",
        aiWeightLike: "Like",
        aiWeightPlay: "Play",
        aiWeightSkip: "Skip",
        aiWeightRepeat: "Repeat",
        aiWeightPlaylistAdd: "Playlist Add",
        aiDiversity: "Diversity Boost",
        aiDiversityDesc: "How much variety to include in recommendations",

        // System section
        systemStayInTray: "🟢 Stay in Tray on Close",
        systemStayInTrayDesc: "When enabled, closing the window keeps KORAI running in the system tray",
        systemTrayNotification: "Show Notification on Hide",
        systemTrayNotificationDesc: "Show a notification when minimized to tray",
        systemAutoUpdate: "Auto-Check Updates",
        systemAutoUpdateDesc: "Automatically check for new versions",
        systemUpdateInterval: "Update Check Interval",
        systemUpdateIntervalDesc: "How often to check for updates",
        systemUpdateInterval12h: "12 hours",
        systemUpdateInterval24h: "24 hours",
        systemUpdateInterval48h: "48 hours",
        systemUpdateIntervalWeekly: "Weekly",
        systemDataDirectory: "Data Directory",
        systemDataDirectoryDesc: "Location of your KORAI data",
        systemOpenDataDir: "Open",
        systemClearCache: "Clear Cache & Telemetry",
        systemClearCacheDesc: "Remove temporary files and performance logs",
        systemClearCacheBtn: "Clear",
        systemVersion: "Current Version",
        systemVersionDesc: "Your KORAI version",
        systemCheckUpdates: "Check for Updates",

        // Advanced section
        advancedPerformance: "Performance Mode",
        advancedPerformanceDesc: "Reduce animations and effects for better performance",
        advancedDebugLogs: "Show Logs in Console",
        advancedDebugLogsDesc: "Enable debug logging to developer console",
        advancedServerPort: "Server Port",
        advancedServerPortDesc: "Local API server port (read-only)",
        advancedResetAll: "⚠️ Reset All Settings",
        advancedResetAllDesc: "Restore all settings to factory defaults. This cannot be undone.",
        advancedResetBtn: "Reset All",

        // Settings actions
        settingsSave: "Save Settings",
        settingsSaveStatus: "Saved!",
        settingsSaveFailed: "Failed to save",
        settingsToastError: "Failed to save: ",
        settingsToastSuccess: "Settings saved successfully!",
        settingsResetConfirm: "⚠️ Are you sure you want to reset ALL settings to defaults?\nThis action cannot be undone!",
        settingsResetConfirm2: "Really? This will reset theme, EQ, playback, and all preferences.",
        settingsDefaultLoading: "Using default settings",
        settingsLoaded: "Settings loaded",

        // Toast messages
        toastSuccess: "Success",
        toastError: "Error",
        toastInfo: "Info",
        toastWarning: "Warning",

        // Explorer Page
        explorerSearchPlaceholder: "Type a song, artist or album name...",
        explorerSearchBtn: "Search",
        explorerNoResults: "No results found",
        explorerSearchHint: "Ready to explore new sounds.",
        explorerSave: "Save",
        explorerSaved: "Saved",
        explorerImport: "Import",
        explorerLikedEmpty: "Your collection is empty",
        explorerLikedEmptyDesc: "Start exploring and save tracks you love.",
        explorerFreshDrops: "Fresh Drops",
        explorerFreshDropsDesc: "The hottest new releases and trending albums updated daily.",
        explorerFetching: "Fetching latest hits...",
        explorerComingSoon: "Coming Soon",
        explorerComingSoonDesc: "This section will be populated with live top charts shortly.",

        // ===== Plugin Manager (plugins.html) =====
        pluginStudio: "Plugin Studio",
        pluginSubtitle: "Extend KORAI with powerful modules and custom integrations",
        pluginTotal: "Total Plugins",
        pluginActive: "Active",
        pluginRunning: "Running",
        pluginSearch: "Search plugins by name or ID...",
        pluginInstall: "Install Plugin",
        pluginInstalled: "Installed Plugins",
        pluginPerformance: "Performance",
        pluginExit: "Exit to Player",
        pluginNoPlugins: "No plugins found",
        pluginInstallHint: "Install a plugin to extend KORAI's capabilities",
        pluginEnable: "Enable",
        pluginDisable: "Disable",
        pluginUninstall: "Uninstall",
        pluginDetails: "Details",
        pluginEnabled: "Active",
        pluginDisabled: "Inactive",
        pluginRunningBadge: "Running",
        pluginBuiltin: "Built-in",
        pluginUninstallConfirm: "Are you sure you want to uninstall this plugin? This action cannot be undone.",
        pluginUninstallSuccess: "Plugin uninstalled successfully",
        pluginUninstallFailed: "Uninstall failed",
        pluginToggleSuccess: "Plugin status changed",
        pluginToggleFailed: "Failed to change plugin status",
        pluginInstallSuccess: "Plugin installed successfully!",
        pluginInstallFailed: "Installation failed",
        pluginMissingPermissions: "Missing permissions",
        pluginLoadingFailed: "Failed to load plugins",
        pluginDevKit: "Developer Kit",
        pluginPerfDashboard: "Performance Dashboard"
    },
    fa: {
        // ===== Time-based greetings =====
        welcomeEarlyMorning: "☀️ طلوع کردی؟ وقت آهنگ‌های پرانرژیه!",
        welcomeMorningPeak: "🌅 صبح بخیر! انرژی صبحت توی اوجشه",
        welcomeLateMorning: "🎵 حوالی ظهر! وقت یه آهنگ خوبه",
        welcomeNoon: "🌤️ ظهر بخیر! با موسیقی ناهار رو مزه‌دار کن",
        welcomeAfternoon: "☕ عصر بخیر! ریتم رو حفظ کن",
        welcomeEarlyEvening: "🌆 عصر بهاره! با موسیقی آروم بگیر",
        welcomeEvening: "✨ شب بخیر! سفر موسیقیت ادامه داره",
        welcomeLateNight: "🌙 پاسی از شب... بذار موسیقی حرف بزنه",
        welcomeMidnight: "🕛 نیمه‌شب‌ها... آرامش رو با نت‌ها پیدا کن",
        welcomeDeepNight: "⭐ سحرگاهه... فقط تو و موسیقی",

        // ===== Navigation & Sidebar =====
        navHomeText: "صفحه اصلی",
        navLibText: "کتابخانه من",
        navArtistsText: "آرتیست‌ها",
        navAlbumsText: "آلبوم‌ها",
        navFavText: "مورد علاقه‌ها",
        navStatsText: "تله‌متری زنده",
        navAdvSearch: "جستجوی پیشرفته",
        navSettingsText: "تنظیمات",

        // ===== Profile & Header =====
        githubBtnText: "ستاره در گیت‌هاب",
        profileName: "کتابخانه شخصی KORAI",
        profileBio: "سیستم مدیریت و پخش هوشمند موسیقی محلی.",
        langBtnText: "EN",

        // ===== Playlists =====
        menuTitle: "لیست‌های پخش",

        // ===== AI & Tools Panel =====
        aiPanelTitle: "هوش مصنوعی صوتی",
        aiPanelDesc: "",
        aiBtnText: "آنالیز صورت",
        similarPlaylist: "پلی‌لیست هوشمند",
        exportLibrary: "خروجی کتابخانه",
        importCue: "CUE Sheet",

        // ===== Import Options =====
        upTextTitle: "افزودن قطعه صوتی",
        upTextSub: "وارد کردن فایل تکی",
        upFolderTitle: "اسکن کامل پوشه",
        upFolderSub: "بارگذاری گروهی دایرکتوری",
        upUrlTitle: "استریم مستقیم از وب",
        upUrlSub: "دریافت آنلاین پیوند MP3",

        // ===== Splash & Loading =====
        loadingText: "در حال پیکربندی موتور صوتی KORAI...",

        // ===== Empty States =====
        emptyLibrary: "کتابخانه موسیقی شما خالی است",
        emptyLibraryDesc: "جهت افزودن آهنگ، از گزینه‌های پنل مدیریت سایدبار استفاده نمایید.",
        emptyFavs: "لیست علاقه‌مندی‌ها خالی است",
        emptyFavsDesc: "آهنگ‌های محبوب خود را لایک کنید تا در این بخش طبقه‌بندی شوند.",
        emptyArtistsState: "هیچ آرتیستی یافت نشد",
        emptyArtistsDesc: "برای مشاهده آرتیست‌ها، آهنگ‌های موسیقی اضافه کنید.",
        emptyAlbumsState: "هیچ آلبومی یافت نشد",
        emptyAlbumsDesc: "برای مشاهده آلبوم‌ها، موسیقی اضافه کنید.",
        emptyPlaylistState: "این لیست پخش خالی است",
        emptyPlaylistTip: "در بخش «کتابخانه من» با راست‌کلیک روی آهنگ‌ها، آن‌ها را به این لیست اضافه کنید.",

        // ===== Statistics =====
        statsTitle: "آمار و تله‌متری پخش",
        statsTotal: "کل آهنگ‌ها",
        statsPlays: "دفعات پخش",
        statsLikes: "محبوب‌ترین‌ها",
        statsHero: "شاهکار صدر جدول پخش شما",
        totalTracksLabel: "کل قطعات بارگذاری شده",
        totalPlaysLabel: "کل دفعات پخش ثبت شده",
        popularLabel: "آثار مورد علاقه",
        topTrackLabel: "این اثر بر اساس تله‌متری سیستم پخش شما در صدر قرار دارد",
        liveSpectrumLabel: "تحلیلگر زنده طیف فرکانسی",
        statsError: "خطا در دریافت اطلاعات آمار از سرور اصلی",
        playedTimes: "بار پخش",

        // ===== Queue =====
        queuePanelTitle: "صف پخش جاری فعال",

        // ===== Fullscreen Player =====
        fsExitText: "خروج از استیج سینمایی",

        // ===== Modals =====
        playlistModalTitle: "ایجاد لیست پخش جدید",
        playlistPlaceholder: "نام پلی‌لیست را وارد کنید...",
        dialogConfirm: "تایید",
        dialogCancel: "انصراف",
        createPlaylist: "ایجاد لیست پخش",
        downloadModalTitle: "دانلود فایل صوتی از لینک",
        downloadPlaceholder: "آدرس لینک مستقیم استریم MP3 را وارد کنید...",
        downloadBtn: "دانلود و بارگذاری",

        // ===== Search & Library =====
        searchPlaceholder: "جستجوی آهنگ، خواننده، آلبوم...",
        rightClickTip: "برای مدیریت و افزودن آهنگ‌ها به پلی‌لیست راست‌کلیک کنید",
        libraryArchive: "آرشیو جامع کتابخانه موسیقی",
        dailySuggestions: "پیشنهادهای هوشمند روزانه",

        // ===== Welcome / OOBE =====
        welcomeOobeTitle: "به استیج KORAI خوش آمدید",
        welcomeOobeSub: "سیستم صوتی بومی و سینمایی طراحی شده برای علاقه‌مندان به موسیقی تراز اول",
        welcomeOobeGoalTitle: "هسته پروژه",
        welcomeOobeGoalDesc: "پلیر موسیقی زیبا، مدرن و کاملاً رایگان. ساخته شده برای ارائه امکانات بی‌پایان و خفن، قابل استفاده روی تمام کامپیوترها بدون هیچ محدودیتی. این پروژه آماده توسعه و دستیابی به اهداف بزرگ‌تر است.",
        welcomeOobeCreatorTitle: "توسعه و هنر",
        welcomeOobeCreatorDesc: "من بهداد کنعانی هستم، یک نوجوان برنامه‌نویس و عاشق موسیقی، هوش مصنوعی، بینایی کامپیوتر و هر چیزی که به برنامه‌نویسی و کامپیوتر ربط داشته باشد. پروژه‌های زیادی دارم؛ برای دیدن آن‌ها به گیت‌هاب من سر بزنید.",
        welcomeOobeBtn: "راه‌اندازی هسته صوتی کلاینت",

        // ===== DSP & EQ =====
        dspTitle: "اکولایزر گرافیکی استودیویی",
        dspPreservePitch: "حفظ گام صدا (Preserve Pitch):",
        tempo: "سرعت پخش (تمپو)",

        // ===== Vocal Separator =====
        vocalSeparatorMode: "جدا ساز صدای خواننده (حذف بلادرنگ صدای خواننده):",
        vocalSeparatorIntensity: "شدت حذف صدای خواننده",
        vocalSeparatorSensitivity: "حساسیت تشخیص",
        vocalSeparatorSensitivityDesc: "مقدار کمتر = حذف تهاجمی‌تر، مقدار بیشتر = حفظ بیشتر سازها",
        vocalSeparatorActive: "🎤 جدا ساز صدای خواننده: حذف هوشمند صدای خواننده فعال شد",
        vocalSeparatorDisabled: "جدا ساز صدای خواننده غیرفعال شد",
        vocalSeparatorError: "خطا در راه‌اندازی جدا ساز صدای خواننده",
        vocalSeparatorFirstPlay: "برای فعال‌سازی جدا ساز صدای خواننده ابتدا یک آهنگ پخش کنید",

        // ===== EQ Bands =====
        eq60Hz: "بیس (60Hz)",
        eq230Hz: "میانی پایین (230Hz)",
        eq910Hz: "میانی (910Hz)",
        eq4kHz: "میانی بالا (4kHz)",
        eq14kHz: "زیر (14kHz)",

        // ===== Track Info =====
        bpmBadge: "ضربان در دقیقه",
        energyBadge: "نمایه انرژی",
        noLyrics: "متن شعر در کانتینر متادیتای صوتی یافت نشد.",
        trackTitle: "عنوان",
        albumTitle: "آلبوم",
        actions: "عملیات",
        artist: "خواننده",
        genre: "سبک",
        duration: "مدت زمان",
        codec: "کدک",
        bitrate: "نرخ بیت",
        sampleRate: "نرخ نمونه‌برداری",
        energy: "انرژی",

        // ===== Playback Controls =====
        playPause: "پخش/توقف",
        previousTrack: "قبلی",
        nextTrack: "بعدی",
        shuffle: "پخش تصادفی",
        repeat: "تکرار",
        volume: "بلندی صدا",

        // ===== Sleep Timer =====
        sleepTimer: "تایمر خواب:",
        sleepOff: "غیرفعال",
        sleepMinutes: "دقیقه",
        cancel: "لغو تایمر",

        // ===== Drag & Drop =====
        dragNotify: "در حال بررسی و تحلیل فایل‌های صوتی رها شده...",
        dragSuccess: "قطعه جدید با موفقیت به آرشیو افزوده شد!",
        dragError: "خطا در پردازش فایل‌های صوتی رها شده.",

        // ===== Genres =====
        genreDetected: "سبک شناسایی شده",
        genreBlues: "بلوز / جاز آکوستیک",
        genreChill: "چیل / لوفای / آرام",
        genreClassical: "کلاسیک / ارکسترال",
        genreAcoustic: "آکوستیک / فولک",
        genrePop: "پاپ / ایندی",
        genreDance: "الکترونیک دنس / هاوس",
        genreEDM: "کلاب EDM / ترنس",
        genreDnB: "درام اند بیس / پرانرژی",
        genreHipHop: "هیپ هاپ / اوربان بیت",
        genreMetal: "راک / هوی متال",
        genreElectronic: "سینث‌ویو / الکترونیک",
        genreLatin: "لاتین / رگه / تروپیکال",

        // ===== AI / Recommendations =====
        smartRecommendations: "پیشنهادهای داینامیک KORAI",
        backToHome: "بازگشت به پیشخوان",
        playlistCreated: "لیست پخش هم‌نمایه با موفقیت ایجاد شد",
        noSimilarTracks: "هیچ نمایه فرکانسی مشابهی در کتابخانه یافت نشد",
        analyzingAudio: "رمزگشایی از الگوهای صوتی...",
        similarity: "شباهت",
        recommended: "توصیه شده",

        // ===== Library Sorting =====
        sortByLabel: "مرتب‌سازی بر اساس:",
        sortDateAdded: "تاریخ اضافه شدن",
        sortTitle: "عنوان آهنگ",
        sortArtist: "خواننده",
        sortBpm: "ضربان (BPM)",
        sortDuration: "مدت زمان",
        allGenres: "همه سبک‌ها",

        // ===== Artists =====
        artistsTitle: "آرتیست‌ها",
        tracksCount: "آهنگ",
        playingArtist: "در حال پخش",
        backToArtists: "بازگشت به آرتیست‌ها",
        playArtist: "پخش همه",

        // ===== Albums =====
        albumsTitle: "آلبوم‌ها",
        backToAlbums: "بازگشت به آلبوم‌ها",
        playAlbum: "پخش همه",

        // ===== Favorites =====
        likedTracks: "آهنگ‌های مورد علاقه",
        totalPlays: "کل پخش‌ها",
        topLiked: "محبوب‌ترین‌ها",
        recentlyAdded: "به‌تازگی اضافه شده",

        // ===== Vocal Extraction =====
        extractionInProgress: "استخراج در حال انجام است",
        preparingExtraction: "آماده‌سازی برای استخراج...",
        extractingVocal: "در حال جدا سازی صدای خواننده...",
        addingToLibrary: "افزودن به کتابخانه...",
        extractionComplete: "استخراج کامل شد!",
        vocalTrackAdded: "آهنگ صدا اضافه شد",
        extractionNoTrack: "آهنگ اضافه شد اما پخش خودکار انجام نشد",
        extractionFailed: "خطا در استخراج",
        noTrackPlaying: "هیچ آهنگی در حال پخش نیست",

        // ===== Settings Page (NEW) =====
        settingsTitle: "تنظیمات",
        settingsSubtitle: "تجربه KORAI خود را پیکربندی کنید",

        // Navigation
        settingsNavPlayback: "پخش",
        settingsNavAudio: "صدا و اکولایزر",
        settingsNavAppearance: "ظاهر",
        settingsNavLibrary: "کتابخانه",
        settingsNavPlugins: "افزونه‌ها",
        settingsNavAI: "هوش مصنوعی و پیشنهادات",
        settingsNavSystem: "سیستم و سینی",
        settingsNavAdvanced: "پیشرفته",
        settingsBackToPlayer: "بازگشت به پلیر",

        // Playback section
        playbackGapless: "پخش بدون وقفه",
        playbackGaplessDesc: "انتقال یکپارچه بین آهنگ‌ها",
        playbackCrossfade: "مدت زمان محو شدن",
        playbackCrossfadeDesc: "مدت زمان محو شدن بین آهنگ‌ها",
        playbackRepeatMode: "حالت تکرار پیش‌فرض",
        playbackRepeatModeDesc: "رفتار تکرار هنگام شروع پخش",
        playbackShuffleDefault: "حالت تصادفی پیش‌فرض",
        playbackShuffleDefaultDesc: "فعال کردن پخش تصادفی به‌طور پیش‌فرض",
        playbackResumeOnStart: "ادامه پخش در شروع",
        playbackResumeOnStartDesc: "ادامه پخش از موقعیت آخرین بار هنگام راه‌اندازی",

        // Audio section
        audioDefaultVolume: "بلندی صدای پیش‌فرض",
        audioDefaultVolumeDesc: "سطح اولیه صدا",
        audioOutput: "خروجی صدا",
        audioOutputDesc: "خروجی استریو یا مونو",
        audioEqPresets: "پریست‌های اکولایزر",
        audioEqFlat: "مسطح",
        audioEqRock: "راک",
        audioEqPop: "پاپ",
        audioEqClassical: "کلاسیک",
        audioEqBass: "تقویت بیس",
        audioEqTreble: "تقویت زیر",

        // Appearance section
        appearanceTheme: "پوسته",
        appearanceThemeDesc: "پوسته بصری را انتخاب کنید",
        appearanceThemeDefault: "پیش‌فرض",
        appearanceThemeLiquidGlass: "شیشه مایع",
        appearanceDirection: "جهت",
        appearanceDirectionDesc: "جهت متن رابط کاربری",
        appearanceDirectionLTR: "چپ‌به‌راست (انگلیسی)",
        appearanceDirectionRTL: "راست‌به‌چپ (فارسی)",
        appearanceFontSize: "اندازه فونت",
        appearanceFontSizeDesc: "اندازه متن را تنظیم کنید",
        appearanceFontSizeSmall: "کوچک",
        appearanceFontSizeMedium: "متوسط",
        appearanceFontSizeLarge: "بزرگ",
        appearanceShowAlbumArt: "نمایش کاور آلبوم در پلیر",
        appearanceShowAlbumArtDesc: "نمایش کاور در نوار پخش",

        // Library section
        libraryScanPath: "مسیر اسکن پیش‌فرض",
        libraryScanPathDesc: "پوشه‌ای که برای موسیقی اسکن می‌شود",
        libraryScanPathNotSet: "تنظیم نشده",
        librarySelectFolder: "انتخاب پوشه",
        libraryFormats: "فرمت‌های پشتیبانی شده",
        libraryFormatsDesc: "فرمت‌های صوتی برای اسکن",
        libraryAutoScan: "اسکن خودکار در راه‌اندازی",
        libraryAutoScanDesc: "اسکن خودکار پوشه کتابخانه هنگام راه‌اندازی",
        libraryMaxScanDepth: "حداکثر عمق اسکن",
        libraryMaxScanDepthDesc: "عمق اسکن زیرپوشه‌ها",

        // Plugins section
        pluginsAutoActivate: "فعال‌سازی خودکار افزونه‌های حیاتی",
        pluginsAutoActivateDesc: "راه‌اندازی خودکار افزونه‌های ضروری",
        pluginsHotReload: "بارگذاری مجدد داغ برای توسعه",
        pluginsHotReloadDesc: "بارگذاری مجدد خودکار افزونه‌ها هنگام تغییر فایل",
        pluginsHookTimeout: "مهلت اجرای هوک",
        pluginsHookTimeoutDesc: "مهلت زمانی برای اجرای هوک افزونه",
        pluginsMemory: "حداکثر حافظه برای هر افزونه",
        pluginsMemoryDesc: "محدودیت حافظه برای هر افزونه",

        // AI section
        aiEnable: "فعال‌سازی پیشنهادات هوش مصنوعی",
        aiEnableDesc: "پیشنهادات شخصی‌سازی شده آهنگ",
        aiDiscovery: "حالت کشف",
        aiDiscoveryDesc: "پیشنهاد آهنگ‌های جدید و ناشنیده",
        aiWeights: "وزن‌های رفتاری",
        aiWeightsDesc: "تأثیر هر تعامل بر پیشنهادات را تنظیم کنید",
        aiWeightLike: "پسندیدن",
        aiWeightPlay: "پخش",
        aiWeightSkip: "پرش",
        aiWeightRepeat: "تکرار",
        aiWeightPlaylistAdd: "افزودن به لیست پخش",
        aiDiversity: "افزایش تنوع",
        aiDiversityDesc: "میزان تنوع در پیشنهادات",

        // System section
        systemStayInTray: "🟢 ماندن در سینی هنگام بستن",
        systemStayInTrayDesc: "هنگام فعال بودن، بستن پنجره KORAI را در سینی سیستم نگه می‌دارد",
        systemTrayNotification: "نمایش اعلان هنگام مخفی شدن",
        systemTrayNotificationDesc: "نمایش اعلان هنگام کوچک شدن به سینی",
        systemAutoUpdate: "بررسی خودکار به‌روزرسانی",
        systemAutoUpdateDesc: "بررسی خودکار نسخه‌های جدید",
        systemUpdateInterval: "فاصله بررسی به‌روزرسانی",
        systemUpdateIntervalDesc: "هر چند وقت یک‌بار به‌روزرسانی بررسی شود",
        systemUpdateInterval12h: "۱۲ ساعت",
        systemUpdateInterval24h: "۲۴ ساعت",
        systemUpdateInterval48h: "۴۸ ساعت",
        systemUpdateIntervalWeekly: "هفتگی",
        systemDataDirectory: "پوشه داده",
        systemDataDirectoryDesc: "محل ذخیره داده‌های KORAI",
        systemOpenDataDir: "باز کردن",
        systemClearCache: "پاک کردن حافظه نهان و تله‌متری",
        systemClearCacheDesc: "حذف فایل‌های موقت و لاگ‌های عملکرد",
        systemClearCacheBtn: "پاک کردن",
        systemVersion: "نسخه فعلی",
        systemVersionDesc: "نسخه KORAI شما",
        systemCheckUpdates: "بررسی به‌روزرسانی",

        // Advanced section
        advancedPerformance: "حالت عملکرد",
        advancedPerformanceDesc: "کاهش انیمیشن‌ها و افکت‌ها برای عملکرد بهتر",
        advancedDebugLogs: "نمایش لاگ‌ها در کنسول",
        advancedDebugLogsDesc: "فعال کردن لاگ‌های دیباگ در کنسول توسعه‌دهنده",
        advancedServerPort: "پورت سرور",
        advancedServerPortDesc: "پورت سرور API محلی (فقط خواندنی)",
        advancedResetAll: "⚠️ بازنشانی همه تنظیمات",
        advancedResetAllDesc: "بازگرداندن همه تنظیمات به حالت پیش‌فرض کارخانه. این عمل قابل بازگشت نیست.",
        advancedResetBtn: "بازنشانی همه",

        // Settings actions
        settingsSave: "ذخیره تنظیمات",
        settingsSaveStatus: "ذخیره شد!",
        settingsSaveFailed: "ذخیره ناموفق",
        settingsToastError: "خطا در ذخیره: ",
        settingsToastSuccess: "تنظیمات با موفقیت ذخیره شد!",
        settingsResetConfirm: "⚠️ آیا از بازنشانی همه تنظیمات به حالت پیش‌فرض مطمئن هستید؟\nاین عمل قابل بازگشت نیست!",
        settingsResetConfirm2: "واقعاً؟ این کار پوسته، اکولایزر، پخش و همه تنظیمات را بازنشانی می‌کند.",
        settingsDefaultLoading: "استفاده از تنظیمات پیش‌فرض",
        settingsLoaded: "تنظیمات بارگذاری شد",

        // Toast messages
        toastSuccess: "موفق",
        toastError: "خطا",
        toastInfo: "اطلاعات",
        toastWarning: "هشدار",

        // Explorer Page
        explorerSearchPlaceholder: "نام آهنگ، خواننده یا آلبوم را تایپ کنید...",
        explorerSearchBtn: "جستجو",
        explorerNoResults: "نتیجه‌ای یافت نشد",
        explorerSearchHint: "آماده کشف صداهای جدید هستید.",
        explorerSave: "ذخیره",
        explorerSaved: "ذخیره شد",
        explorerImport: "وارد کردن",
        explorerLikedEmpty: "مجموعه شما خالی است",
        explorerLikedEmptyDesc: "کاوش را شروع کنید و آهنگ‌های مورد علاقه خود را ذخیره کنید.",
        explorerFreshDrops: "تازه‌ترین‌ها",
        explorerFreshDropsDesc: "جدیدترین انتشارات و آلبوم‌های داغ روزانه به‌روز می‌شوند.",
        explorerFetching: "دریافت آخرین آهنگ‌ها...",
        explorerComingSoon: "به زودی",
        explorerComingSoonDesc: "این بخش به زودی با نمودارهای زنده پر می‌شود.",

        // ===== Plugin Manager (plugins.html) =====
        pluginStudio: "استودیوی پلاگین",
        pluginSubtitle: "قابلیت‌های KORAI را با ماژول‌های قدرتمند گسترش دهید",
        pluginTotal: "کل پلاگین‌ها",
        pluginActive: "فعال",
        pluginRunning: "در حال اجرا",
        pluginSearch: "جستجوی پلاگین بر اساس نام یا شناسه...",
        pluginInstall: "نصب پلاگین",
        pluginInstalled: "پلاگین‌های نصب شده",
        pluginPerformance: "عملکرد",
        pluginExit: "بازگشت به پلیر",
        pluginNoPlugins: "هیچ پلاگینی یافت نشد",
        pluginInstallHint: "برای افزایش قابلیت‌های KORAI یک پلاگین نصب کنید",
        pluginEnable: "فعال کردن",
        pluginDisable: "غیرفعال کردن",
        pluginUninstall: "حذف",
        pluginDetails: "جزئیات",
        pluginEnabled: "فعال",
        pluginDisabled: "غیرفعال",
        pluginRunningBadge: "در حال اجرا",
        pluginBuiltin: "پیش‌فرض",
        pluginUninstallConfirm: "آیا از حذف این پلاگین مطمئن هستید؟ این عمل قابل بازگشت نیست.",
        pluginUninstallSuccess: "پلاگین با موفقیت حذف شد",
        pluginUninstallFailed: "خطا در حذف پلاگین",
        pluginToggleSuccess: "وضعیت پلاگین تغییر کرد",
        pluginToggleFailed: "خطا در تغییر وضعیت پلاگین",
        pluginInstallSuccess: "پلاگین با موفقیت نصب شد!",
        pluginInstallFailed: "خطا در نصب پلاگین",
        pluginMissingPermissions: "مجوزهای مورد نیاز موجود نیست",
        pluginLoadingFailed: "خطا در بارگذاری پلاگین‌ها",
        pluginDevKit: "کیت توسعه",
        pluginPerfDashboard: "داشبورد عملکرد"
    }
};



if (typeof window !== 'undefined') {
    window.translations = translations;
}


if (typeof module !== 'undefined' && module.exports) {
    module.exports = translations;
}