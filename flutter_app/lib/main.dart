import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'package:permission_handler/permission_handler.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ClearEarApp());
}

class ClearEarApp extends StatelessWidget {
  const ClearEarApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ClearEar AI',
      theme: ThemeData(
        primarySwatch: Colors.cyan,
        scaffoldBackgroundColor: const Color(0xFF0a0d14), // Matches web app background
      ),
      home: const HearingAidScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HearingAidScreen extends StatefulWidget {
  const HearingAidScreen({super.key});

  @override
  State<HearingAidScreen> createState() => _HearingAidScreenState();
}

class _HearingAidScreenState extends State<HearingAidScreen> {
  WebViewController? _controller;
  bool _hasPermission = false;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _requestPermissions();
  }

  Future<void> _requestPermissions() async {
    // Request microphone permission at the OS level
    final status = await Permission.microphone.request();
    if (status.isGranted) {
      try {
        _initWebView();
        setState(() {
          _hasPermission = true;
        });
      } catch (e) {
        print("Error initializing WebView: $e");
        // We can just set permission to false so it shows the mic screen or a new error screen
        setState(() {
          _hasPermission = false;
          _isLoading = false;
        });
      }
    } else {
      setState(() {
        _hasPermission = false;
        _isLoading = false;
      });
    }
  }

  void _initWebView() {
    late final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final WebViewController controller = WebViewController.fromPlatformCreationParams(params);

    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0a0d14));

    if (controller.platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(true);
      (controller.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
      
      // Auto-grant microphone requests originating from the WebView (Web Audio API)
      (controller.platform as AndroidWebViewController).setOnPlatformPermissionRequest(
        (PlatformWebViewPermissionRequest request) {
          request.grant();
        },
      );
    }

    // Load the local HTML file (offline)
    controller.loadFlutterAsset('assets/index.html').then((_) {
      setState(() {
        _isLoading = false;
      });
    });

    _controller = controller;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: _hasPermission && _controller != null
            ? Stack(
                children: [
                  WebViewWidget(controller: _controller!),
                  if (_isLoading)
                    const Center(
                      child: CircularProgressIndicator(color: Colors.cyan),
                    ),
                ],
              )
            : Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.mic_off, size: 64, color: Colors.redAccent),
                      const SizedBox(height: 24),
                      const Text(
                        'Microphone Permission Required',
                        style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'ClearEar AI requires microphone access to amplify and process audio.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white70, fontSize: 16),
                      ),
                      const SizedBox(height: 32),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.cyan,
                          foregroundColor: Colors.black,
                          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                        ),
                        onPressed: _requestPermissions,
                        child: const Text('Grant Permission', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}
