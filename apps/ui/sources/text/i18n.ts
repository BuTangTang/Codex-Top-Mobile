import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, SUPPORTED_LANGUAGES, getLanguageEnglishName, getLanguageNativeName, type SupportedLanguage } from './_all';
import type { Translations } from './_types';
import { zhHans } from './translations/zh-Hans';

export { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, SUPPORTED_LANGUAGES, getLanguageEnglishName, getLanguageNativeName, type SupportedLanguage };

type TranslationFunction = (params: never) => string;
type TranslationLeaf = string | TranslationFunction;
type TranslationNode = Record<string, unknown>;

type JoinPath<Prefix extends string, Key extends string> = Prefix extends '' ? Key : `${Prefix}.${Key}`;

type TranslationKeyFromStructure<T, Prefix extends string = ''> = {
    [K in keyof T & string]:
        NonNullable<T[K]> extends TranslationLeaf
            ? JoinPath<Prefix, K>
            : NonNullable<T[K]> extends TranslationNode
                ? TranslationKeyFromStructure<NonNullable<T[K]>, JoinPath<Prefix, K>>
                : never;
}[keyof T & string];

type TranslationValueAtPath<T, Key extends string> = Key extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
        ? TranslationValueAtPath<NonNullable<T[Head]>, Tail>
        : never
    : Key extends keyof T
        ? NonNullable<T[Key]>
        : never;

export type TranslationKey = TranslationKeyFromStructure<Translations>;

export type TranslationParams<K extends TranslationKey> =
    TranslationValueAtPath<Translations, K> extends (...args: infer Args) => string
        ? Args extends []
            ? never
            : Args[0]
        : never;

export type TranslationKeyNoParams = {
    [K in TranslationKey]: TranslationParams<K> extends never ? K : never;
}[TranslationKey];

function isTranslationFunction(value: unknown): value is TranslationFunction {
    return typeof value === 'function';
}

function getValueAtPath(root: TranslationNode, key: string): unknown {
    const parts = key.split('.').filter(Boolean);
    if (parts.length === 0) return undefined;

    let current: unknown = root;
    for (const part of parts) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as TranslationNode)[part];
    }
    return current;
}

/** 产品固定读取简体中文；设备语言及历史偏好均不参与显示选择。 */
function resolveRawTranslationValue(key: string): unknown {
    return getValueAtPath(zhHans as TranslationNode, key);
}

function resolveStringValue(key: string): string {
    const value = resolveRawTranslationValue(key);
    if (typeof value === 'string') return value;
    return key;
}

function resolveCallableTranslation(key: TranslationKey): TranslationFunction | null {
    const value = resolveRawTranslationValue(key);
    return isTranslationFunction(value) ? value : null;
}

export function hasTranslation(key: string): boolean {
    return resolveRawTranslationValue(key) !== undefined;
}

export function getTranslationValue(key: string): unknown {
    return resolveRawTranslationValue(key);
}

/** 保留设置同步调用接口；忽略旧语言偏好，不改写账号设置或触发重启。 */
export function setPreferredLanguageFromSettings(_value: unknown): void {
    // 简体中文是产品约定；保留历史值供现有持久化及跨版本设置流程使用。
}

export function t<K extends TranslationKey>(
    key: K,
    ...params: TranslationParams<K> extends never ? [] : [params: TranslationParams<K>]
): string {
    const callable = resolveCallableTranslation(key);
    if (callable) {
        return callable(params[0] as never);
    }
    return resolveStringValue(key);
}

export function tLoose(key: string): string {
    return resolveStringValue(key);
}
