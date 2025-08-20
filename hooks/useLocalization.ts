import React, { createContext, useState, useContext, useCallback, ReactNode } from 'react';
import { translations, Language } from '../localization';

// Helper to get nested properties from an object using a dot-notation string
const get = (obj: any, path: string) => {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

interface LocalizationContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, replacements?: { [key: string]: string | number }) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

type LocalizationProviderProps = {
    children: ReactNode;
};

const detectInitialLanguage = (): Language => {
    if (typeof navigator !== 'undefined' && navigator.language) {
        if (navigator.language.startsWith('ru')) {
            return 'ru';
        }
    }
    return 'en';
};

export const LocalizationProvider = ({ children }: LocalizationProviderProps) => {
    const [language, setLanguage] = useState<Language>(detectInitialLanguage);

    const t = useCallback((key: string, replacements?: { [key: string]: string | number }) => {
        let translation = get(translations[language], key);

        if (typeof translation !== 'string') {
            // Fallback to English if translation is missing or not a string
            translation = get(translations.en, key);
            if (typeof translation !== 'string') {
                console.warn(`Translation not found for key: ${key}`);
                return key; // Return the key itself if not found in English either
            }
        }
        
        if (replacements) {
            Object.keys(replacements).forEach(rKey => {
                const regex = new RegExp(`\\{${rKey}\\}`, 'g');
                translation = translation.replace(regex, String(replacements[rKey]));
            });
        }

        return translation;
    }, [language]);

    return React.createElement(
        LocalizationContext.Provider,
        { value: { language, setLanguage, t } },
        children
    );
};

export const useLocalization = (): LocalizationContextType => {
    const context = useContext(LocalizationContext);
    if (context === undefined) {
        throw new Error('useLocalization must be used within a LocalizationProvider');
    }
    return context;
};