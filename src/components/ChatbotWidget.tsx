import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, Bot, Sparkles, Trash2, ArrowRight } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

const MAX_CHAT_MESSAGE_LENGTH = 2000;

export default function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'greeting',
      role: 'assistant',
      text: "Hello! I am the Smart Garbage Monitoring Assistant. 👋\n\nI can help with this system's login, registration, profiles, bin inspections, collection requests, complaints, notifications, payments, reports, and role-based dashboards. Pwede pud ka mangutana sa Cebuano.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const presetQuestions = [
    {
      label: "Payment Summary (Admin)",
      text: "Summarize payments",
    },
    {
      label: "Manual Inspection",
      text: "How do I submit a manual garbage bin inspection?",
    },
    {
      label: "Collection Request",
      text: "How do I create or track a collection request?",
    },
    {
      label: "Collector GPS",
      text: "Where can an authorized user view the collector location?",
    },
    {
      label: "Notifications",
      text: "How do system notifications and emergency alerts work?",
    },
    {
      label: "Complaints",
      text: "How do I submit and monitor a complaint?",
    },
    {
      label: "Profile",
      text: "How do I update my profile information?",
    },
  ];

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend: string) => {
    const normalizedText = textToSend.trim();

    if (!normalizedText || isLoading) return;

    if (normalizedText.length > MAX_CHAT_MESSAGE_LENGTH) {
      setMessages(prev => [...prev, {
        id: `ai-err-${Date.now()}`,
        role: 'assistant',
        text: `Please keep your question to ${MAX_CHAT_MESSAGE_LENGTH} characters or less.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: normalizedText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      // Map frontend messages into backend format
      const chatHistory = messages.map(m => ({
        role: m.role,
        text: m.text
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${
            localStorage.getItem('token') ||
            localStorage.getItem('authToken') ||
            sessionStorage.getItem('token') ||
            sessionStorage.getItem('authToken') ||
            ''
          }`
        },
        body: JSON.stringify({
          message: normalizedText,
          chatHistory: chatHistory
        })
      });

      const data = await res
        .json()
        .catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.message ||
            data.error ||
            'Unable to contact the assistant.',
        );
      }
      
      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        text: data.text || "I could not prepare a response. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMessage: ChatMessage = {
        id: `ai-err-${Date.now()}`,
        role: 'assistant',
        text: err instanceof Error ? err.message : "I am having trouble reaching the server. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: 'greeting',
        role: 'assistant',
        text: "Welcome back! Ask about the Smart Garbage Monitoring System in English or Cebuano.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  // Safe manual markdown parser supporting basic bolding, bullets and newlines
  const renderMessageContent = (text: string) => {
    return text.split('\n').map((line, lineIdx) => {
      let content: React.ReactNode = line;
      
      // Handle simple bullet points starting with - or *
      const isBullet = line.startsWith('- ') || line.startsWith('* ');
      if (isBullet) {
        content = line.substring(2);
      }

      // Handle simple bold (**text**)
      const boldParts = String(content).split('**');
      if (boldParts.length > 1) {
        content = boldParts.map((part, partIdx) => 
          partIdx % 2 === 1 ? <strong key={partIdx} className="font-extrabold text-white">{part}</strong> : part
        );
      }

      if (isBullet) {
        return (
          <li key={lineIdx} className="list-disc ml-4 my-1 pl-1 text-[11px] font-medium leading-relaxed text-slate-200">
            {content}
          </li>
        );
      }

      return (
        <p key={lineIdx} className="text-[11px] font-medium leading-relaxed text-slate-200 my-1">
          {content}
        </p>
      );
    });
  };

  return (
    <>
      {/* Floating Action Button */}
      <div className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
        <motion.button
          id="btn-chatbot-float"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(prev => !prev)}
          className={`flex items-center justify-center p-4 rounded-full shadow-2xl transition-colors cursor-pointer border focus:outline-none ${
            isOpen 
              ? 'bg-slate-900 border-slate-700 text-slate-200' 
              : 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500'
          }`}
        >
          {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
          
          {/* Subtle AI sparkle notify badge */}
          {!isOpen && (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border border-white"></span>
            </span>
          )}
        </motion.button>
      </div>

      {/* Main Intelligent Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id="panel-chatbot-sidebar"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="fixed bottom-36 right-4 left-4 md:left-auto md:w-96 h-[500px] bg-slate-950/95 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl z-50 flex flex-col backdrop-blur-md"
          >
            {/* Header portion */}
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="w-9 h-9 bg-emerald-500/15 rounded-xl flex items-center justify-center border border-emerald-500/35">
                    <Bot className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-slate-950 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase text-slate-100 tracking-wider">Smart Garbage Assistant</h3>
                  <div className="flex items-center gap-1 text-[9px] font-extrabold text-emerald-400 tracking-tight uppercase">
                    <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                    Role-Scoped In-App Guide
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={handleClearChat}
                  title="Clear conversation"
                  className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Chat message streams list */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 scrollbar-thin scrollbar-thumb-emerald-500/20">
              {messages.map((msg) => (
                <div 
                  key={msg.id}
                  className={`flex gap-2.5 max-w-[85%] ${
                    msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 shrink-0 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                  )}
                  <div>
                    <div 
                      className={`px-3 py-2.5 rounded-2xl text-[11px] ${
                        msg.role === 'user'
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white rounded-tr-none'
                          : 'bg-slate-900 border border-slate-800 rounded-tl-none text-slate-200'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        renderMessageContent(msg.text)
                      ) : (
                        <p className="font-semibold text-[11px] leading-relaxed text-slate-100">{msg.text}</p>
                      )}
                    </div>
                    <span className={`block text-[8px] font-bold text-slate-500 uppercase mt-1 px-1 tracking-wider ${
                      msg.role === 'user' ? 'text-right' : ''
                    }`}>
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              ))}

              {/* Loader visual state */}
              {isLoading && (
                <div className="flex gap-2.5 max-w-[80%]">
                  <div className="w-6 h-6 shrink-0 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-center animate-pulse">
                    <Bot className="w-3.5 h-3.5 text-emerald-400" />
                  </div>

                  <div className="px-3.5 py-3 rounded-2xl bg-slate-900 border border-slate-800 rounded-tl-none">
                    <p className="mb-2 text-[10px] font-semibold text-slate-400">
                      AI is thinking...
                    </p>

                    <div className="flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Helper Quick pills section */}
            <div className="p-3 bg-slate-900/40 border-t border-slate-900">
              <p className="text-[8px] font-black uppercase text-slate-500 tracking-wider mb-2 px-1">Suggested Inquiries</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {presetQuestions.map((pill, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(pill.text)}
                    className="text-[9px] font-extrabold px-2.5 py-1.5 rounded-full border border-slate-800 hover:border-emerald-600/50 bg-slate-950/60 text-slate-300 hover:text-emerald-400 transition-all text-left cursor-pointer flex items-center gap-1 group"
                  >
                    <span>{pill.label}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-slate-600 group-hover:text-emerald-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>

            {/* Input keyboard form */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputText);
              }}
              className="p-3 bg-slate-900/80 border-t border-slate-800 flex gap-2 items-center"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isLoading ? 'Please wait...' : 'Ask about the system...'}
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none transition-colors"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white disabled:text-slate-500 p-2 rounded-xl transition-all cursor-pointer focus:outline-none flex items-center justify-center shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
