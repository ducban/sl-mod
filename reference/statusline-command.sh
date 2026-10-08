#!/bin/bash
# Claude Code status line
# Line 1: current folder | model | context used
# Line 2: 5h remaining% (reset time) | 7d remaining% (countdown - reset date/time)

input=$(cat)
now_epoch=$(date +%s)

# --- Line 1 ---

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
if [ -n "$cwd" ]; then
  dir=$(basename "$cwd")
  dir_c=$(printf '\033[1;36m%s\033[0m' "$dir")
else
  dir_c=""
fi

model=$(echo "$input" | jq -r '.model.display_name // empty')
if [ -n "$model" ]; then
  model_c=$(printf '\033[36m%s\033[0m' "$model")
else
  model_c=""
fi

ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$ctx_used" ]; then
  ctx_str=$(awk -v u="$ctx_used" 'BEGIN{printf "Ctx:%.0f%%", u}')
  ctx_c=$(printf '\033[33m%s\033[0m' "$ctx_str")
else
  ctx_c=""
fi

line1=""
for p in "$dir_c" "$model_c" "$ctx_c"; do
  if [ -n "$p" ]; then
    if [ -z "$line1" ]; then line1="$p"; else line1="$line1 | $p"; fi
  fi
done

# --- Line 2 ---

five_used=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_resets_at=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
if [ -n "$five_used" ]; then
  five_remaining=$(awk -v u="$five_used" 'BEGIN{printf "%.0f", 100-u}')
  if [ -n "$five_resets_at" ]; then
    five_time=$(LC_TIME=C date -d "@$five_resets_at" +"%-I:%M%P" 2>/dev/null)
    five_str="5h:${five_remaining}% (${five_time})"
  else
    five_str="5h:${five_remaining}%"
  fi
  five_c=$(printf '\033[32m%s\033[0m' "$five_str")
else
  five_c=""
fi

week_used=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_resets_at=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
if [ -n "$week_used" ]; then
  week_remaining=$(awk -v u="$week_used" 'BEGIN{printf "%.0f", 100-u}')
  if [ -n "$week_resets_at" ]; then
    week_datetime=$(LC_TIME=C date -d "@$week_resets_at" +"%b %-d %-I:%M%P" 2>/dev/null)
    week_countdown=$(awk -v resets="$week_resets_at" -v now="$now_epoch" 'BEGIN{
      remaining=resets-now
      if (remaining<0) remaining=0
      d=int(remaining/86400)
      h=int((remaining%86400)/3600)
      m=int((remaining%3600)/60)
      printf "%dd %dh %dm", d, h, m
    }')
    week_str="7d:${week_remaining}% (${week_countdown} - ${week_datetime})"
  else
    week_str="7d:${week_remaining}%"
  fi
  week_c=$(printf '\033[35m%s\033[0m' "$week_str")
else
  week_c=""
fi

line2=""
for p in "$five_c" "$week_c"; do
  if [ -n "$p" ]; then
    if [ -z "$line2" ]; then line2="$p"; else line2="$line2 | $p"; fi
  fi
done

if [ -n "$line2" ]; then
  printf '%s\n%s' "$line1" "$line2"
else
  printf '%s' "$line1"
fi
