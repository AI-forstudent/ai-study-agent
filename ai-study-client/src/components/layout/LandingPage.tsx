import { FileText, Wand2, Users, ArrowRight, Sparkles, Library } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onOpenGallery: () => void;
}

const features = [
  {
    icon: FileText,
    title: 'Analyze',
    description: 'Upload any PDF and instantly get per-page summaries, contextual Q&A, and deep document chat.',
    accent: 'bg-blue-50 text-blue-600',
    border: 'hover:border-blue-200',
  },
  {
    icon: Wand2,
    title: 'Customize',
    description: 'Build unique study personas in the Persona Lab — tune pedagogy, tone, and language to match how you learn.',
    accent: 'bg-indigo-50 text-indigo-600',
    border: 'hover:border-indigo-200',
  },
  {
    icon: Users,
    title: 'Connect',
    description: 'Share processed knowledge and explore the Study Commons — a community library of annotated academic content.',
    accent: 'bg-violet-50 text-violet-600',
    border: 'hover:border-violet-200',
  },
];

export default function LandingPage({ onGetStarted, onOpenGallery }: LandingPageProps) {
  return (
    <div className="min-h-dvh w-full bg-white flex flex-col" dir="ltr">

      {/* ── Nav bar ────────────────────────────────────────────────────── */}
      <header className="w-full px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800 tracking-tight">StudyAgent</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenGallery}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <Library className="w-4 h-4" />
            Community
          </button>
          <button
            onClick={onGetStarted}
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            Sign in
          </button>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-10 sm:pt-16 pb-12 sm:pb-24 text-center">

        {/* Eyebrow badge */}
        <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold tracking-wide uppercase px-4 py-1.5 rounded-full mb-8 border border-indigo-100">
          <Sparkles className="w-3.5 h-3.5" />
          Powered by Gemini AI
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-slate-900 leading-[1.1] tracking-tight max-w-3xl">
          Your Personal{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            AI Academic
          </span>
          {' '}Squad
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-lg sm:text-xl text-slate-500 max-w-xl leading-relaxed">
          Upload papers, compose unique study personas, and join the community of learners.
        </p>

        {/* CTA */}
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold px-6 py-3 sm:px-8 sm:py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-300 hover:-translate-y-0.5 active:translate-y-0 text-base"
          >
            Get Started
            <ArrowRight className="w-5 h-5" />
          </button>
          <button
            onClick={onOpenGallery}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <Library className="w-4 h-4" />
            Explore Community Library
          </button>
        </div>

        {/* ── Feature cards ──────────────────────────────────────────────── */}
        <div className="mt-12 sm:mt-24 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 w-full max-w-4xl text-left">
          {features.map(({ icon: Icon, title, description, accent, border }) => (
            <div
              key={title}
              className={`bg-white border border-slate-100 ${border} rounded-2xl p-7 shadow-sm transition-all duration-200 hover:shadow-md`}
            >
              <div className={`w-11 h-11 rounded-xl ${accent} flex items-center justify-center mb-5`}>
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-2">{title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="text-center pb-8 text-xs text-slate-400">
        © {new Date().getFullYear()} StudyAgent · Built for learners
      </footer>

    </div>
  );
}
