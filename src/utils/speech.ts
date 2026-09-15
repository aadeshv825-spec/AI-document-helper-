// Simple browser Web Speech API integration for Hindi and English voice readout

export function speakText(text: string, lang: 'hi-IN' | 'en-US' = 'en-US'): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
    utterance.lang = lang;
    utterance.rate = 0.95;

    // Try finding matching voice
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
    if (match) {
      utterance.voice = match;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
