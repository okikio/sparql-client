#!/bin/sh
# Attest the actual post-exec runtime child before known-byte worker code starts library work.
# Only private Linux Docker lanes use this file; library consumers retain their own permissions.
set -u
role=$1; gate=$2; nonce=$3; shift 3
case "$role" in root) owner=0;; ordinary) owner=1000;; *) exit 64;; esac
case "$gate" in /tmp/library-attest-????????-????-????-????-????????????) ;; *) exit 64;; esac
case "$nonce" in ????????-????-????-????-????????????) ;; *) exit 64;; esac
case "$gate$nonce" in *[!a-z0-9/-]*) exit 64;; esac
[ "$#" -gt 0 ] || exit 64
umask 077
mkdir -m 700 "$gate" || exit 65
gate_identity=$(stat -c %d:%i:%u:%g:%a "$gate") || exit 74
owned_gate() { [ -d "$gate" ] && [ ! -L "$gate" ] && [ "$(stat -c %d:%i:%u:%g:%a "$gate")" = "$gate_identity" ]; }
child=
acquired_start=
child_stamp() {
  raw=$(cat "/proc/$child/stat" 2>/dev/null) || return 1
  remainder=${raw##*) }
  set -- $remainder
  [ "$#" -ge 20 ] && [ "$2" = "$$" ] || return 1
  case "$1" in R|S|D|I) ;; *) return 1;; esac
  n=19; while [ "$n" -gt 0 ]; do shift; n=$((n - 1)); done
  case "$1" in ''|*[!0-9]*) return 1;; esac
  printf '%s' "$1"
}
retire() {
  result=$?
  trap - EXIT HUP INT TERM
  printf '\n{"phase":"attestation-supervisor","exit":%s}\n' "$result"
  if [ -n "$child" ]; then
    # Reobserve both live parent and starttime before EACH signal; shell reaping may permit PID reuse.
    if [ -r "/proc/$child/status" ]; then cat "/proc/$child/status"; fi
    if [ -n "$acquired_start" ] && [ "$(child_stamp)" = "$acquired_start" ]; then kill -TERM "$child" 2>/dev/null || :; fi
    sleep 0.1
    if [ -n "$acquired_start" ] && [ "$(child_stamp)" = "$acquired_start" ]; then kill -KILL "$child" 2>/dev/null || :; fi
    wait "$child"; observed=$?
    printf '\n{"phase":"attestation-child","pid":%s,"exit":%s}\n' "$child" "$observed"
    child=
  fi
  if owned_gate; then
    rm -r -- "$gate" || result=74
  else
    result=74
  fi
  exit "$result"
}
trap retire EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
printf '\nAttestation launch argvNulHex\n'
printf '%s\0' "$@" | od -An -v -tx1
# Only the acquired supervisor creates the fixed raw/approval slots, before child acquisition.
(set -C; : > "$gate/status"; : > "$gate/cmdline"; : > "$gate/approval.pending") || exit 74
status_identity=$(stat -c %d:%i:%u:%g:%a:%h "$gate/status") || exit 74
cmdline_identity=$(stat -c %d:%i:%u:%g:%a:%h "$gate/cmdline") || exit 74
approval_identity=$(stat -c %d:%i:%u:%g:%a:%h "$gate/approval.pending") || exit 74
"$@" --attest "$gate" "$nonce" "$role" &
child=$!
acquired_start=$(child_stamp) || acquired_start=
# Startup admission is operational, not a latency benchmark. The outer command/container deadline remains separate.
round=0
while [ ! -e "$gate/ready" ]; do
  [ "$round" -lt 300 ] || exit 75
  owned_gate || exit 65
  kill -0 "$child" 2>/dev/null || { wait "$child"; result=$?; printf '\n{"phase":"attestation-child","pid":%s,"exit":%s}\n' "$child" "$result"; child=; exit 76; }
  sleep 0.1
  round=$((round + 1))
done
[ -f "$gate/ready" ] && [ ! -L "$gate/ready" ] || exit 65
[ "$(stat -c %u:%g:%a:%h "$gate/ready")" = "$owner:$owner:600:1" ] || exit 65
[ "$(stat -c %s "$gate/ready")" = "$((${#child} + ${#nonce} + 2))" ] || exit 65
printf '%s %s\n' "$child" "$nonce" | cmp - "$gate/ready" || exit 65
starttime=
snapshot() {
  # Cat reads the launched runtime's proc entry, never its own /proc/self/status.
  owned_gate || return 1
  # Fixed report names are created exclusively before any child code; replacement aliases are refused.
  [ -f "$gate/status" ] && [ ! -L "$gate/status" ] && [ "$(stat -c %d:%i:%u:%g:%a:%h "$gate/status")" = "$status_identity" ] || return 1
  cat "/proc/$child/status" > "$gate/status" || return 1
  raw_stat=$(cat "/proc/$child/stat") || return 1
  remainder=${raw_stat##*) }
  set -- $remainder
  [ "$#" -ge 20 ] || return 1
  n=19; while [ "$n" -gt 0 ]; do shift; n=$((n - 1)); done
  case "$1" in ''|*[!0-9]*) return 1;; esac
  if [ -n "$starttime" ] && [ "$starttime" != "$1" ]; then return 1; fi
  starttime=$1
  [ -n "$acquired_start" ] && [ "$starttime" = "$acquired_start" ] || return 1
  printf '\nAttestation runtime pid=%s starttime=%s cmdlineNulHex\n' "$child" "$starttime"
  [ -f "$gate/cmdline" ] && [ ! -L "$gate/cmdline" ] && [ "$(stat -c %d:%i:%u:%g:%a:%h "$gate/cmdline")" = "$cmdline_identity" ] || return 1
  head -c 65537 "/proc/$child/cmdline" > "$gate/cmdline" || return 1
  [ "$(wc -c < "$gate/cmdline")" -le 65536 ] || return 1
  od -An -v -tx1 "$gate/cmdline"
  pid=; tgid=; ppid=; uid=; gid=; inh=; prm=; eff=; amb=; nnp=; bnd=; state=
  while IFS=: read -r key values; do
    set -f
    set -- $values
    case "$key" in
      Pid) [ -z "$pid" ] && [ "$#" = 1 ] || return 1; pid=$1;;
      Tgid) [ -z "$tgid" ] && [ "$#" = 1 ] || return 1; tgid=$1;;
      PPid) [ -z "$ppid" ] && [ "$#" = 1 ] || return 1; ppid=$1;;
      Uid) [ -z "$uid" ] && [ "$#" = 4 ] || return 1; uid="$1:$2:$3:$4";;
      Gid) [ -z "$gid" ] && [ "$#" = 4 ] || return 1; gid="$1:$2:$3:$4";;
      CapInh) [ -z "$inh" ] && [ "$#" = 1 ] || return 1; inh=$1;;
      CapPrm) [ -z "$prm" ] && [ "$#" = 1 ] || return 1; prm=$1;;
      CapEff) [ -z "$eff" ] && [ "$#" = 1 ] || return 1; eff=$1;;
      CapBnd) [ -z "$bnd" ] && [ "$#" = 1 ] || return 1; bnd=$1;;
      CapAmb) [ -z "$amb" ] && [ "$#" = 1 ] || return 1; amb=$1;;
      NoNewPrivs) [ -z "$nnp" ] && [ "$#" = 1 ] || return 1; nnp=$1;;
      State) [ -z "$state" ] && [ "$#" -ge 1 ] || return 1; state=$1;;
    esac
  done < "$gate/status"
  [ "$pid" = "$child" ] && [ "$tgid" = "$child" ] && [ "$ppid" = "$$" ] || return 1
  [ "$uid" = "$owner:$owner:$owner:$owner" ] && [ "$gid" = "$owner:$owner:$owner:$owner" ] || return 1
  [ "$bnd" = 0000000000000001 ] && [ "$nnp" = 1 ] && [ "$inh" = 0000000000000000 ] && [ "$amb" = 0000000000000000 ] || return 1
  case "$state" in R|S|D|I) ;; *) return 1;; esac
  if [ "$role" = root ]; then expected=0000000000000001; else expected=0000000000000000; fi
  [ "$eff" = "$expected" ] && [ "$prm" = "$expected" ] || return 1
}
# Preserve raw observations even when the policy rejects them.
snapshot; accepted=$?
printf '\nAttestation child=%s parent=%s nonce=%s role=%s accepted=%s\n' "$child" "$$" "$nonce" "$role" "$accepted"
cat "$gate/status" || exit 74
[ "$accepted" = 0 ] || exit 77
# Recheck the live PID/parent immediately before approval; a shell may already reap a dead background process.
snapshot || exit 77
owned_gate && [ -f "$gate/approval.pending" ] && [ ! -L "$gate/approval.pending" ] && [ "$(stat -c %d:%i:%u:%g:%a:%h "$gate/approval.pending")" = "$approval_identity" ] || exit 65
printf '%s %s %s\n' "$child" "$nonce" "$role" > "$gate/approval.pending" || exit 74
chmod 400 "$gate/approval.pending" || exit 74
mv "$gate/approval.pending" "$gate/approval" || exit 74
wait "$child"; result=$?
printf '\n{"phase":"attestation-child","pid":%s,"exit":%s}\n' "$child" "$result"
child=
exit "$result"
