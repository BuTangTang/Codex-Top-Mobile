import * as React from 'react';

export type SessionResumeAction = () => Promise<boolean>;

const SessionResumeContext = React.createContext<SessionResumeAction | null>(null);

export function SessionResumeProvider(props: {
    onResumeSession: SessionResumeAction;
    children: React.ReactNode;
}): React.ReactElement {
    const onResumeSessionRef = React.useRef(props.onResumeSession);
    React.useEffect(() => {
        onResumeSessionRef.current = props.onResumeSession;
    }, [props.onResumeSession]);
    const resumeSession = React.useCallback(async () => onResumeSessionRef.current(), []);

    return (
        <SessionResumeContext.Provider value={resumeSession}>
            {props.children}
        </SessionResumeContext.Provider>
    );
}

export function useSessionResumeAction(): SessionResumeAction | null {
    return React.useContext(SessionResumeContext);
}
