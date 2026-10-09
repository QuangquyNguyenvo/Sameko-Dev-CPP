// Sameko Dev C++ setup: a themed front end for the NSIS installer that electron-builder makes.
//
// The window (Setup.xaml) asks where to install, then runs the embedded NSIS installer silently
// (/S /D=<folder>) and shows its progress. NSIS still does the real work - files, shortcuts,
// registry, uninstaller - so updates through electron-updater and uninstalling are unchanged.
//
// Built by scripts/build-setup.js with the C# 5 compiler that ships with .NET Framework 4.8
// (present on every Windows 10/11), so it needs no SDK and no runtime download.
//
//   sameko-dev-cpp-<version>-installer.exe          install
//   sameko-dev-cpp-<version>-installer.exe --demo     walk through every step without installing anything

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;

namespace Sameko.Setup
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            bool demo = Array.IndexOf(args, "--demo") >= 0;
            var app = new Application();
            app.ShutdownMode = ShutdownMode.OnMainWindowClose;
            var ui = new SetupWindow(demo);
            return app.Run(ui.Window);
        }
    }

    internal class SetupWindow
    {
        const string ProductName = "Sameko Dev C++";
        const string ExeName = "Sameko Dev C++.exe";

        public readonly Window Window;
        readonly bool demo;
        readonly long payloadBytes;
        readonly string version;
        bool installing;
        string installedExe;

        public SetupWindow(bool demo)
        {
            this.demo = demo;
            payloadBytes = ReadResourceLong("payload.size", 900L * 1024 * 1024);
            version = ReadResourceText("payload.version", "");

            using (var xaml = Resource("Setup.xaml"))
                Window = (Window)XamlReader.Load(xaml);
            var icon = LoadImage("icon.png");
            Window.Icon = icon;
            Get<Image>("Logo").Source = icon;
            Window.Title = ProductName + " Setup" + (version.Length > 0 ? " " + version : "");
            if (demo) Get<TextBlock>("Subtitle").Text = "Preview - nothing will be installed";

            var card = Get<Grid>("Card");
            card.SizeChanged += delegate { card.Clip = new RectangleGeometry(new Rect(0, 0, card.ActualWidth, card.ActualHeight), 26, 26); };

            Get<Border>("DragArea").MouseLeftButtonDown += delegate { Window.DragMove(); };
            Get<Button>("MinButton").Click += delegate { Window.WindowState = WindowState.Minimized; };
            Get<Button>("CloseButton").Click += delegate { if (!installing) Window.Close(); };
            Window.Closing += delegate (object s, CancelEventArgs e) { if (installing) e.Cancel = true; };

            var pathBox = Get<TextBox>("PathBox");
            pathBox.Text = DefaultFolder();
            pathBox.TextChanged += delegate { UpdateSpace(); };
            UpdateSpace();
            Get<Button>("BrowseButton").Click += delegate
            {
                string picked = FolderPicker.Pick(Window, ParentOrSelf(pathBox.Text));
                if (picked != null)
                {
                    // Like the NSIS wizard: picking a parent folder installs into a subfolder of it.
                    pathBox.Text = picked.TrimEnd('\\').EndsWith(ProductName, StringComparison.OrdinalIgnoreCase)
                        ? picked : System.IO.Path.Combine(picked, ProductName);
                }
            };
            Get<Button>("InstallButton").Click += delegate { Start(); };
            Get<Button>("DoneButton").Click += delegate { Finish(); };

            Animate();
        }

        // ---- Look ----

        void Animate()
        {
            // The logo bobs, like on the app's loading screen.
            var bob = new DoubleAnimation(0, -7, TimeSpan.FromSeconds(1.6));
            bob.AutoReverse = true;
            bob.RepeatBehavior = RepeatBehavior.Forever;
            bob.EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut };
            ((TranslateTransform)Get<Image>("Logo").RenderTransform).BeginAnimation(TranslateTransform.YProperty, bob);

            // Bubbles drifting up.
            var canvas = Get<Canvas>("Bubbles");
            double[,] spec = { { 18, 14, 9.0, 0.0 }, { 12, 444, 12.0, 2.5 }, { 24, 428, 11.0, 5.0 }, { 14, 26, 10.0, 6.0 } };
            for (int i = 0; i < spec.GetLength(0); i++)
            {
                var b = new Ellipse
                {
                    Width = spec[i, 0],
                    Height = spec[i, 0],
                    Stroke = new SolidColorBrush(Color.FromArgb(46, 224, 240, 255)),
                    StrokeThickness = 1.6,
                    Fill = new SolidColorBrush(Color.FromArgb(10, 224, 240, 255)),
                    Opacity = 0
                };
                Canvas.SetLeft(b, spec[i, 1]);
                Canvas.SetTop(b, 580);
                canvas.Children.Add(b);
                var dur = TimeSpan.FromSeconds(spec[i, 2]);
                var begin = TimeSpan.FromSeconds(spec[i, 3]);
                var rise = new DoubleAnimation(580, 120, dur) { BeginTime = begin, RepeatBehavior = RepeatBehavior.Forever };
                var fade = new DoubleAnimationUsingKeyFrames { BeginTime = begin, RepeatBehavior = RepeatBehavior.Forever, Duration = dur };
                fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromPercent(0)));
                fade.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromPercent(0.15)));
                fade.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromPercent(0.8)));
                fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromPercent(1)));
                b.BeginAnimation(Canvas.TopProperty, rise);
                b.BeginAnimation(UIElement.OpacityProperty, fade);
            }
        }

        void ShowPage(string name)
        {
            foreach (var page in new[] { "SetupPage", "ProgressPage", "DonePage" })
            {
                var el = Get<FrameworkElement>(page);
                if (page != name) { el.Visibility = Visibility.Collapsed; continue; }
                el.Visibility = Visibility.Visible;
                el.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
                var lift = new TranslateTransform(0, 10);
                el.RenderTransform = lift;
                lift.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(10, 0, TimeSpan.FromMilliseconds(320))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            }
        }

        void SetProgress(double fraction, string status, string detail)
        {
            fraction = Math.Max(0, Math.Min(1, fraction));
            var track = Get<Grid>("Track");
            var fill = Get<Border>("Fill");
            double target = Math.Max(10, track.ActualWidth * fraction);
            fill.BeginAnimation(FrameworkElement.WidthProperty,
                new DoubleAnimation(target, TimeSpan.FromMilliseconds(450)) { EasingFunction = new QuadraticEase() });
            Get<TextBlock>("PercentText").Text = ((int)Math.Round(fraction * 100)) + "%";
            if (status != null) Get<TextBlock>("StatusText").Text = status;
            if (detail != null) Get<TextBlock>("DetailText").Text = detail;
        }

        void UpdateSpace()
        {
            string text = "";
            try
            {
                string root = System.IO.Path.GetPathRoot(System.IO.Path.GetFullPath(Get<TextBox>("PathBox").Text));
                var drive = new DriveInfo(root);
                text = string.Format("Needs {0}  ·  {1} free on {2}", Size(payloadBytes), Size(drive.AvailableFreeSpace), root.TrimEnd('\\'));
            }
            catch (Exception) { }
            Get<TextBlock>("SpaceText").Text = text;
        }

        // ---- Install ----

        void Start()
        {
            string folder;
            try { folder = System.IO.Path.GetFullPath(Get<TextBox>("PathBox").Text.Trim()); }
            catch (Exception) { Get<TextBlock>("SpaceText").Text = "That is not a valid folder."; return; }

            installing = true;
            ShowPage("ProgressPage");
            SetProgress(0, "Getting ready…", folder);

            bool desktop = Get<CheckBox>("DesktopBox").IsChecked == true;
            if (demo) { RunDemo(folder); return; }

            bool elevate = !CanWrite(folder);
            var worker = new Thread(delegate () { Install(folder, desktop, elevate); });
            worker.IsBackground = true;
            worker.Start();
        }

        void Install(string folder, bool desktop, bool elevate)
        {
            string error = null;
            try
            {
                string temp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "sameko-setup-" + Process.GetCurrentProcess().Id);
                Directory.CreateDirectory(temp);
                string nsis = System.IO.Path.Combine(temp, "installer.exe");
                using (var src = Resource("payload.exe"))
                using (var dst = File.Create(nsis))
                    src.CopyTo(dst);

                string exe = System.IO.Path.Combine(folder, ExeName);
                long before = FolderSize(folder);
                bool upgrade = File.Exists(exe);

                var psi = new ProcessStartInfo(nsis);
                // /D must come last and unquoted (NSIS reads the rest of the line as the folder).
                psi.Arguments = (elevate ? "/S /allusers" : "/S /currentuser") + " /D=" + folder;
                psi.UseShellExecute = true;
                if (elevate) psi.Verb = "runas";
                var proc = Process.Start(psi);

                // NSIS reports no progress when silent, so it is read from the folder filling up. An
                // upgrade first removes the old version; until the folder has emptied, the bar waits.
                bool cleared = !upgrade || before < payloadBytes * 0.3;
                double shown = 0;
                while (!proc.WaitForExit(400))
                {
                    long now = FolderSize(folder);
                    if (!cleared && now < payloadBytes * 0.3) cleared = true;
                    string status = !cleared ? "Removing the old version…" : StatusFor(now);
                    double fraction = cleared ? Math.Min(0.97, (double)now / payloadBytes) : 0.02;
                    shown = Math.Max(shown, fraction);
                    double s = shown;
                    Window.Dispatcher.BeginInvoke(new Action(delegate { SetProgress(s, status, folder); }));
                }
                if (proc.ExitCode != 0 || !File.Exists(exe))
                    error = "The installer stopped with code " + proc.ExitCode + ". Nothing was changed if it never started; otherwise run Setup again.";
                else
                {
                    installedExe = exe;
                    if (!desktop) RemoveDesktopShortcut();
                }
                try { Directory.Delete(temp, true); } catch (Exception) { }
            }
            catch (Win32Exception ex)
            {
                // 1223: the UAC prompt was declined.
                error = ex.NativeErrorCode == 1223
                    ? "Installing into this folder needs administrator rights. Choose a folder in your user profile, or accept the prompt."
                    : ex.Message;
            }
            catch (Exception ex) { error = ex.Message; }

            string err = error;
            Window.Dispatcher.BeginInvoke(new Action(delegate { Done(err); }));
        }

        string StatusFor(long bytes)
        {
            double f = (double)bytes / payloadBytes;
            if (f < 0.35) return "Copying the editor…";
            if (f < 0.9) return "Installing the GCC compiler…";
            return "Finishing up…";
        }

        void RunDemo(string folder)
        {
            string[] steps = { "Removing the old version…", "Copying the editor…", "Installing the GCC compiler…", "Finishing up…" };
            var start = DateTime.Now;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            timer.Tick += delegate
            {
                double f = (DateTime.Now - start).TotalSeconds / 7.0;
                if (f >= 1)
                {
                    timer.Stop();
                    SetProgress(1, steps[3], folder);
                    Done(null);
                    return;
                }
                SetProgress(f, steps[Math.Min(3, (int)(f * 4))], folder);
            };
            timer.Start();
        }

        void Done(string error)
        {
            installing = false;
            if (error == null) SetProgress(1, "Done", null);
            var delay = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(error == null ? 500 : 0) };
            delay.Tick += delegate
            {
                delay.Stop();
                ShowPage("DonePage");
                var title = Get<TextBlock>("DoneTitle");
                var text = Get<TextBlock>("DoneText");
                var button = Get<Button>("DoneButton");
                if (error == null)
                {
                    title.Text = "All set!";
                    text.Text = demo
                        ? "This was a preview: nothing was installed."
                        : "Sameko Dev C++ and its compiler are installed. Updates will install themselves.";
                    button.Content = Get<CheckBox>("LaunchBox").IsChecked == true && !demo ? "Open Sameko" : "Close";
                }
                else
                {
                    title.Text = "Setup didn't finish";
                    title.Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0x8A, 0x8A));
                    text.Text = error;
                    button.Content = "Close";
                    installedExe = null;
                }
            };
            delay.Start();
        }

        void Finish()
        {
            if (installedExe != null && Get<CheckBox>("LaunchBox").IsChecked == true)
            {
                try { Process.Start(new ProcessStartInfo(installedExe) { UseShellExecute = true }); } catch (Exception) { }
            }
            Window.Close();
        }

        // ---- Folders ----

        static string DefaultFolder()
        {
            // An existing install: offer its folder, so the update lands in place.
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (var key = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                {
                    if (key == null) continue;
                    foreach (string name in key.GetSubKeyNames())
                    {
                        using (var app = key.OpenSubKey(name))
                        {
                            if (app == null || !(app.GetValue("DisplayName") as string ?? "").StartsWith(ProductName)) continue;
                            string loc = app.GetValue("InstallLocation") as string;
                            if (!string.IsNullOrEmpty(loc)) return loc.TrimEnd('\\');
                            // electron-builder leaves InstallLocation empty; the uninstaller sits in
                            // the install folder: "D:\Sameko Dev C++\Uninstall Sameko Dev C++.exe" /currentuser
                            string un = app.GetValue("UninstallString") as string ?? "";
                            int q = un.IndexOf('"', 1);
                            if (un.StartsWith("\"") && q > 1) return System.IO.Path.GetDirectoryName(un.Substring(1, q - 1));
                        }
                    }
                }
            }
            return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", ProductName);
        }

        static string ParentOrSelf(string folder)
        {
            try { return Directory.Exists(folder) ? folder : System.IO.Path.GetDirectoryName(folder); }
            catch (Exception) { return null; }
        }

        static bool CanWrite(string folder)
        {
            try
            {
                Directory.CreateDirectory(folder);
                string probe = System.IO.Path.Combine(folder, ".sameko-write-test");
                File.WriteAllText(probe, "");
                File.Delete(probe);
                return true;
            }
            catch (Exception) { return false; }
        }

        static long FolderSize(string folder)
        {
            long total = 0;
            try
            {
                if (!Directory.Exists(folder)) return 0;
                foreach (var f in new DirectoryInfo(folder).EnumerateFiles("*", SearchOption.AllDirectories))
                {
                    try { total += f.Length; } catch (Exception) { }
                }
            }
            catch (Exception) { }
            return total;
        }

        static void RemoveDesktopShortcut()
        {
            foreach (var dir in new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory) })
            {
                try { File.Delete(System.IO.Path.Combine(dir, ProductName + ".lnk")); } catch (Exception) { }
            }
        }

        static string Size(long bytes)
        {
            if (bytes >= 1L << 30) return (bytes / (double)(1L << 30)).ToString("0.0") + " GB";
            return (bytes / (double)(1L << 20)).ToString("0") + " MB";
        }

        // ---- Resources ----

        T Get<T>(string name) where T : class
        {
            return (T)Window.FindName(name);
        }

        static Stream Resource(string name)
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (s == null) throw new FileNotFoundException("Missing resource " + name);
            return s;
        }

        static string ReadResourceText(string name, string fallback)
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (s == null) return fallback;
            using (var r = new StreamReader(s)) return r.ReadToEnd().Trim();
        }

        static long ReadResourceLong(string name, long fallback)
        {
            long v;
            return long.TryParse(ReadResourceText(name, ""), out v) && v > 0 ? v : fallback;
        }

        static BitmapImage LoadImage(string name)
        {
            var img = new BitmapImage();
            img.BeginInit();
            img.StreamSource = Resource(name);
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.EndInit();
            img.Freeze();
            return img;
        }
    }

    // Windows' own folder picker (the Explorer-style one, not the old tree dialog of WinForms).
    internal static class FolderPicker
    {
        public static string Pick(Window owner, string start)
        {
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            try
            {
                uint options;
                dialog.GetOptions(out options);
                dialog.SetOptions(options | 0x20 | 0x40 | 0x800); // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST
                dialog.SetTitle("Choose where to install Sameko Dev C++");
                if (!string.IsNullOrEmpty(start) && Directory.Exists(start))
                {
                    IShellItem folder;
                    Guid iid = typeof(IShellItem).GUID;
                    if (SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder) == 0) dialog.SetFolder(folder);
                }
                IntPtr hwnd = new System.Windows.Interop.WindowInteropHelper(owner).Handle;
                if (dialog.Show(hwnd) != 0) return null;
                IShellItem result;
                dialog.GetResult(out result);
                string path;
                result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }
            catch (Exception) { return null; }
            finally { Marshal.ReleaseComObject(dialog); }
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);

        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        class FileOpenDialogRCW { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes();
            void SetFileTypeIndex();
            void GetFileTypeIndex();
            void Advise();
            void Unadvise();
            void SetOptions(uint fos);
            void GetOptions(out uint fos);
            void SetDefaultFolder(IShellItem si);
            void SetFolder(IShellItem si);
            void GetFolder();
            void GetCurrentSelection();
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetFileName();
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel();
            void SetFileNameLabel();
            void GetResult(out IShellItem si);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler();
            void GetParent();
            void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
        }
    }
}
