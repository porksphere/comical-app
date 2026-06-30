const { withAppDelegate } = require('expo/config-plugins');

// TEMPORARY launch-crash diagnostics. The app is crashing immediately on iOS
// (RCTFatal -> abort) and three separate attempts at intercepting it from
// JS via global.ErrorUtils.setGlobalHandler all failed identically — the
// crash never reaches that handler at all, so it isn't going through the
// classic JS exception-reporting path. RCTFatal() is the one universal,
// native choke point every fatal-report path funnels through right before
// crashing (confirmed by every crash log's backtrace), so hook it directly:
// RCTSetFatalHandler lets us see the NSError (with the JS stack trace) and
// decide not to crash, instead showing it on the app's *existing* window
// (not a freshly created one — that's what crashed in an earlier diagnostic
// attempt, racing iOS's scene-connection lifecycle).
//
// Remove this plugin once the real bug is found and fixed.
const MARKER = 'RCTSetFatalHandler';

const INJECTION = `
    RCTSetFatalHandler { maybeError in
      // The block's NSError* param bridges into Swift as the \`Error\` protocol,
      // which has no .userInfo — recover the concrete NSError to read it.
      guard let error = maybeError else { return }
      let nsError = error as NSError
      let stack = (nsError.userInfo[RCTJSRawStackTraceKey] as? String)
        ?? (nsError.userInfo[RCTJSStackTraceKey] as? String)
        ?? ""
      let message = "\\(nsError.localizedDescription)\\n\\n\\(stack)"
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        guard let root = UIApplication.shared.windows.first?.rootViewController else { return }
        let alert = UIAlertController(title: "Fatal JS error (diagnostic)", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        root.present(alert, animated: true)
      }
    }
`;

module.exports = function withFatalHandler(config) {
  return withAppDelegate(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(MARKER)) {
      return config;
    }

    const anchor = '    let delegate = ReactNativeDelegate()';
    if (!contents.includes(anchor)) {
      throw new Error('with-fatal-handler: could not find injection point in AppDelegate.swift');
    }

    config.modResults.contents = contents.replace(anchor, INJECTION + anchor);
    return config;
  });
};
